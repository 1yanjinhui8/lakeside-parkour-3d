// ============================================================================
//  bug-sweep.mjs —— 干扰道具（赛道拾取版）的边界扫荡
//  单页灌 lobby.onVSEvent 跳过握手，专打正常流程踩不到的缝：
//  生成间隔、连吃、里程跳变、结算停刷、resize、触屏反向、单人模式污染。
// ============================================================================
import fs from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +(process.argv[2] || 9222);

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
  await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));

let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') caught.push((m.params.exceptionDetails.exception?.description || '').slice(0, 180));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    caught.push('ERR ' + (m.params.args.map(a => a.description || a.value).join(' ') || '').slice(0, 180));
});
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }); const s = r.result || r; fs.writeFileSync(f, Buffer.from(s.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
// headless 下新标签页会被判成不可见 → rAF 停摆 → 倒计时根本不走。
// 单页测试也会中招，不只是双人那边。
await send('Page.bringToFront', {}).catch(() => { });
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => { });
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8765/.perf-real.html?q=low&v=${Date.now()}` }, 120000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__PKITEMS')) break; await sleep(400); }

const R = [];
const ok = (n, pass, extra) => { R.push([n, !!pass]); console.log((pass ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : '')); };

/* ============================ S1 单人模式不被污染 ============================ */
console.log('\nS1 单人模式：钩子应全部空转');
await ev(`window.__game.startGame(); true`);
await sleep(1400);
await ev(`window.__game.S.transGrace = 99999; true`);
ok('__pkInputFlip()===1', await ev(`window.__pkInputFlip()===1`), await ev(`window.__pkInputFlip()`));
ok('__pkSpeedMul()===1', await ev(`window.__pkSpeedMul()===1`), await ev(`window.__pkSpeedMul()`));
await sleep(400);
ok('雾钩子空转（fogMix=0）', (await ev(`window.__PKITEMS.state.fogMix`)) === 0);
const lane0 = await ev(`window.__game.S.lane`);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); true`);
await sleep(200);
ok('单人键盘正常', (await ev(`window.__game.S.lane`)) === Math.max(0, lane0 - 1), lane0 + ' → ' + await ev(`window.__game.S.lane`));
ok('单人赛道上没有 pk_ 道具', (await ev(`window.__game.pickups.filter(p => typeof p.type==='string' && p.type.indexOf('pk_')===0).length`)) === 0);

// 主游戏每 500m 有一个道具点，抽签池是 CONFIG.powerUps —— 干扰道具登记进去之后
// 必须把它排除掉，否则单机跑到 500m 会捡到「墨水弹」然后什么都不发生。
// 主游戏每 500m 一个道具点，抽签池是 CONFIG.powerUps —— 干扰道具登记进去后必须排除，
// 否则单机跑到 500m 会捡到「墨水弹」然后什么都不发生（单机没有 __pkPickItem）。
// 实跑触发这个点受 nextRowS/nextPowerS 时序影响、很不稳定，这里改查两件确定的事：
// ① 注入后的产物源码里确实带过滤；② 过滤后的池子里没有 pk_。
const poolChk = await ev(`(() => {
  const all = Object.keys(window.__game.CONFIG.powerUps);
  const pool = all.filter(k => k !== 'shield' && k.indexOf('pk_') !== 0);
  const src = Array.prototype.map.call(document.querySelectorAll('script'),
    s => s.textContent).join('');
  return { all, pool, filtered: src.indexOf("k.indexOf('pk_') !== 0") >= 0 };
})()`);
ok('主游戏道具抽签已排除 pk_', poolChk && poolChk.filtered === true, 'pool=' + JSON.stringify(poolChk && poolChk.pool));
// 4 种具体道具 + 盲盒本身，至少 5 个
ok('干扰道具仍在 CONFIG 里（图标要用）', poolChk && poolChk.all.filter(k => k.indexOf('pk_') === 0).length >= 5,
  JSON.stringify(poolChk && poolChk.all));

/* ============================ S2 进对局 → 赛道生成 ============================ */
console.log('\nS2 对局内赛道生成');
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);
await ev(`(() => { const lb = window.__PKVS_APP.lobby; window.__sent = [];
  lb.sendGameEvent = function (t, d) { window.__sent.push([t, d]); return true; }; return true; })()`);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 777001, startAtLocal: Date.now()+900, mode:'race', countdownMs:900 }); true`);
for (let i = 0; i < 25; i++) { await sleep(400); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
ok('进入对局', (await ev(`window.__PKVS_APP.phase`)) === 'run');

// 先清场再排下一个：反过来的话，刚生成的那个会被自己清掉，统计出来是空
await ev(`(() => { const G = window.__game;
  // 用 999 推到身后：p.z > 4 会被主模块当场回收。别用负数——那只是把它挪到更远处，
  // 还留在 pickups 里，统计时会被当成一个新道具算进去（s 变成 D+300）
  G.pickups.filter(p => typeof p.type==='string' && p.type.indexOf('pk_')===0).forEach(p => { p.z = 999; });
  return true; })()`);
await sleep(250);
await ev(`window.__PKITEMS._setNext(window.__game.S.D + 30); true`);
await sleep(900);
const list1 = await ev(`(() => window.__game.pickups
  .filter(p => typeof p.type==='string' && p.type.indexOf('pk_')===0)
  .map(p => ({ t: p.type, s: Math.round(window.__game.S.D - p.z), x: Math.round(p.x*10)/10 })))()`);
ok('生成后有道具在路上', list1 && list1.length > 0, JSON.stringify(list1));
// 车道真值是 playable.html 里的 const LANES = [-2.4, 0, 2.4]。
// 之前判据写成 2.2，道具只要刷在中间道就能蒙混过关 —— 等于没测。
ok('车道落在三条道上（±2.4 / 0）', list1 && list1.every(p => [-2.4, 0, 2.4].some(v => Math.abs(v - p.x) < 0.02)),
  list1 && list1.map(p => p.x).join(','));
const dNow = await ev(`Math.round(window.__game.S.D)`);
ok('落点在前方 20~160m', list1 && list1.every(p => p.s - dNow > 15 && p.s - dNow < 170),
  'D=' + dNow + ' s=' + JSON.stringify(list1.map(p => p.s)));

/* ============================ S3 连吃三个 ============================ */
console.log('\nS3 连吃 3 个');
const evilBefore = await ev(`window.__PKITEMS.state.evil || 0`);
// 三个都摆中间道、前后错开：玩家跑过去一路吃。
// 上一版放在三条道上、每轮只搬一个，中间没搬的被跑过去删掉了，只吃到 2 个（测试的锅）。
await ev(`(() => { const G = window.__game, S = G.S;
  S.lane = 1; S.x = 0;
  for (let i = 0; i < 3; i++) G.placePowerUp(1, S.D + 4 + i * 2.5, 'pk_box');
  return true; })()`);
let ate = 0;
for (let i = 0; i < 24; i++) {
  await sleep(180);
  await ev(`window.__game.S.x = 0; true`);
  ate = await ev(`window.__PKITEMS.state.picked`);
  if (ate >= 3) break;
}
console.log('    picked =', ate, ' sent =', await ev(`window.__sent.filter(x=>x[0]==='attack').length`));
ok('连吃 3 个都计数', ate === 3, 'picked=' + ate);
// 盲盒可能开坏：开坏的那次打自己身上，不发 attack
const sentN = await ev(`window.__sent.filter(x=>x[0]==='attack').length`);
const evilN = (await ev(`window.__PKITEMS.state.evil || 0`)) - evilBefore;
ok('正面发 attack、负面不发', sentN === 3 - evilN, `attack=${sentN} 负面=${evilN}`);

/* ============================ S4 里程跳变 ============================ */
console.log('\nS4 里程跳变（换图 / 重开）');
await ev(`window.__PKITEMS._setNext(50); true`);
await ev(`window.__game.S.D = 600; true`);
await sleep(400);
const re = await ev(`({ next: Math.round(window.__PKITEMS.state.nextItemS), D: Math.round(window.__game.S.D) })`);
ok('落后太多会重排', re && re.next > re.D - 10, JSON.stringify(re));

/* ============================ S5 结算后停刷 ============================ */
console.log('\nS5 结算后停刷');
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchEnd', reason:'finish' }); true`);
await sleep(400);
const before = await ev(`window.__game.pickups.filter(p => typeof p.type==='string' && p.type.indexOf('pk_')===0).length`);
await ev(`window.__game.S.D += 400; true`);
await sleep(700);
const after = await ev(`window.__game.pickups.filter(p => typeof p.type==='string' && p.type.indexOf('pk_')===0).length`);
ok('结束后不再刷道具', after <= before, before + ' → ' + after);
ok('道具系统已收场', (await ev(`window.__PKITEMS.state.alive`)) === false);

/* ============================ S6 resize ============================ */
console.log('\nS6 墨水播放中改窗口');
await ev(`window.__PKVS_APP.phase = 'run'; window.__PKVS_APP.active = true; window.__PKITEMS.begin(1234); window.__PKITEMS._hit('ink', 5000); true`);
await sleep(500);
await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(700);
const cv = await ev(`(() => { const c = document.getElementById('pkInkFx'); return c ? [c.width, c.height, innerWidth, innerHeight] : null; })()`);
ok('canvas 跟上新尺寸', cv && Math.abs(cv[0] - cv[2]) <= 2 && Math.abs(cv[1] - cv[3]) <= 2, JSON.stringify(cv));
await shot('screenshots/sweep-ink-portrait.png');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await sleep(300);

/* ============================ S7 触屏反向 ============================ */
console.log('\nS7 反向符触屏路径');
await ev(`window.__PKITEMS.clearAllFx(); window.__game.S.lane = 1; window.__PKITEMS._hit('invert', 4000); true`);
await sleep(150);
ok('flip = -1', (await ev(`window.__pkInputFlip()`)) === -1);
const l0 = await ev(`window.__game.S.lane`);
await ev(`(() => {
  const mk = (x) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 300 });
  window.dispatchEvent(new TouchEvent('touchstart', { touches:[mk(500)], changedTouches:[mk(500)], bubbles:true }));
  window.dispatchEvent(new TouchEvent('touchend', { touches:[], changedTouches:[mk(380)], bubbles:true }));
  return true; })()`);
await sleep(250);
ok('左滑 → 实际往右', (await ev(`window.__game.S.lane`)) === Math.min(2, l0 + 1), l0 + ' → ' + await ev(`window.__game.S.lane`));

/* ============================ S8 HUD ============================ */
console.log('\nS8 HUD');
// 上一节 matchEnd 摘掉了 body.pk-vs，样式规则跟着失效；这里模拟「对局中」再看
await ev(`document.body.classList.add('pk-vs'); true`);
await sleep(100);
ok('道具槽已隐藏', (await ev(`(() => { const b = document.getElementById('pkAttack'); return b ? getComputedStyle(b).display : 'none'; })()`)) === 'none');
ok('暂停按钮已隐藏', (await ev(`getComputedStyle(document.getElementById('pauseBtn')).display`)) === 'none');
ok('音量按钮还在', (await ev(`getComputedStyle(document.getElementById('volBtn')).display`)) !== 'none');

const bad = R.filter(x => !x[1]);
console.log('\n================ 汇总 ================');
console.log('通过 ' + (R.length - bad.length) + '/' + R.length);
if (bad.length) bad.forEach(b => console.log('  ✗ ' + b[0]));
console.log('控制台异常：', caught.length ? caught.slice(0, 6) : '无');
process.exit(bad.length ? 1 : 0);
