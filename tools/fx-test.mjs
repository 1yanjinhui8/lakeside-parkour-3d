// ============================================================================
//  fx-test.mjs —— 「道具用出来之后」会发生什么
//  ---------------------------------------------------------------------------
//  和其它几套的区别：item-test 测「吃 → 发事件」，mode-test 测模式参数，
//  这一套只盯**效果已经挂在身上**之后的各种收尾：
//    重复命中 / 同时四种 / 到期 / 换图 / 出局 / 时间到 / 提前退出 / 重开
//  这些路径共同点是「没人主动清」，全靠生命周期自己收干净，
//  漏一个就是墨糊在菜单上、雾卡在眼前、左右键反着用到下一局。
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
  if (m.method === 'Runtime.exceptionThrown') caught.push((m.params.exceptionDetails.exception?.description || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    caught.push('ERR ' + (m.params.args.map(a => a.description || a.value).join(' ') || '').slice(0, 200));
});
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }); const s = r.result || r; fs.writeFileSync(f, Buffer.from(s.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront', {}).catch(() => { });
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => { });
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8765/.perf-real.html?q=low&v=${Date.now()}` }, 120000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__PKITEMS')) break; await sleep(400); }

const R = [];
const ok = (n, pass, extra) => { R.push([n, !!pass]); console.log((pass ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : '')); };

// 直接灌 matchStart 时大厅的倒计时层会被挂上、却没有自己的时钟去推它，
// 于是永远停在「3」。真机联机不会这样（playthrough 的截图是干净的），
// 这里只是把它摘掉，免得截图和视觉判断被它干扰。
const hideStaleCd = `(() => { const e = document.getElementById('pkCountdown');
  if (e) e.classList.remove('on'); return true; })()`;

// 画布上还有多少不透明像素（判断墨到底在不在）
const INK_PX = `(() => {
  const cv = document.getElementById('pkInkFx');
  if (!cv || !cv.width) return 0;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) n++;
  return n; })()`;

// 当前所有效果的状态快照
const SNAP = `(() => {
  const I = window.__PKITEMS, g = window.__game, t = performance.now();
  const live = {};
  ['ink','slow','fog','invert'].forEach(k => {
    const u = I.state.hits[k];
    if (u && t < u) live[k] = Math.round(u - t);
  });
  const cls = id => { const e = document.getElementById(id); return e ? e.className : ''; };
  return {
    live,
    mul: I.speedMul(), flip: I.inputFlip(), mix: +I.state.fogMix.toFixed(3),
    near: +g.scene.fog.near.toFixed(1), far: +g.scene.fog.far.toFixed(1),
    fogOn: cls('pkFxFog').indexOf('on') >= 0, invOn: cls('pkFxInvert').indexOf('on') >= 0,
    slowOn: cls('pkFxSlow').indexOf('on') >= 0,
    canvases: document.querySelectorAll('#pkInkFx').length,
  }; })()`;

/* ---------------- 进场：真对局 ---------------- */
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);
await ev(`(() => { const lb = window.__PKVS_APP.lobby; window.__sent = [];
  lb.sendGameEvent = function (t, d) { window.__sent.push([t, d]); return true; }; return true; })()`);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 20261103, startAtLocal: Date.now()+900,
  mode:'race', options:{ matchMode:'d3000' }, countdownMs:900 }); true`);
for (let i = 0; i < 25; i++) { await sleep(400); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
ok('进入对局（3000m）', (await ev(`window.__PKVS_APP.phase`)) === 'run', await ev(`window.__PKVS_APP.phase`));
await ev(hideStaleCd);

const baseFog = await ev(`({ near: +window.__game.scene.fog.near.toFixed(1), far: +window.__game.scene.fog.far.toFixed(1) })`);

/* ============================ F1 墨水被短时长重复命中 ============================ */
console.log('\nF1 墨水中途被更短的命中刷新：视觉不能提前消失');
await ev(`window.__PKITEMS.clearAllFx(); window.__PKITEMS._hit('ink', 4000); true`);
await sleep(300);
await ev(`window.__PKITEMS._hit('ink', 700); true`);      // 负面漏墨瓶就是这种更短的时长
await sleep(200);
const f1a = await ev(SNAP);
console.log('    刷新后:', JSON.stringify(f1a.live), 'mix=' + f1a.mix);
ok('状态仍是原来那个更晚的结束时间', f1a.live.ink >= 3300, 'ink 剩 ' + f1a.live.ink + 'ms');

// 过掉「700ms + 260ms 余量」之后再查一次：修之前这里墨已经没了
await sleep(1500);
const f1Px = await ev(INK_PX);
const f1b = await ev(`({ inkLeft: Math.round((window.__PKITEMS.state.hits.ink||0) - performance.now()) })`);
ok('过了短命中的时长，墨还在画面上', f1Px > 200, '像素=' + f1Px + '，状态还剩 ' + f1b.inkLeft + 'ms');
await shot('screenshots/fx-ink-refresh.png');

// 等到真到期
for (let i = 0; i < 20; i++) { await sleep(400); if (!(await ev(`window.__PKITEMS.state.hits.ink > performance.now()`))) break; }
await sleep(600);
const f1c = await ev(SNAP);
ok('到期后画布清空', (await ev(INK_PX)) === 0, '像素=' + await ev(INK_PX));
// fogMix 每帧只收敛 16%，是渐隐不是瞬间归零；低帧率下要两秒多
for (let i = 0; i < 14; i++) { await sleep(300); if ((await ev(`window.__PKITEMS.state.fogMix`)) === 0) break; }
ok('到期后 fogMix 归零', (await ev(`window.__PKITEMS.state.fogMix`)) === 0,
  'mix=' + await ev(`window.__PKITEMS.state.fogMix`));

/* ============================ F2 四种同时在场，独立过期 ============================ */
console.log('\nF2 四种效果同时在身上');
await ev(`window.__PKITEMS.clearAllFx(); true`);
await ev(`window.__PKITEMS._hit('slow', 1000); window.__PKITEMS._hit('invert', 2000);
  window.__PKITEMS._hit('fog', 3500); window.__PKITEMS._hit('ink', 4000); true`);
await sleep(1300);
const f2a = await ev(SNAP);
console.log('    1.3s:', JSON.stringify(f2a.live));
ok('粘液先到期（速度恢复 1）', f2a.mul === 1, 'mul=' + f2a.mul);
ok('其它三个还在', !!(f2a.live.invert && f2a.live.fog && f2a.live.ink), JSON.stringify(f2a.live));
ok('反向仍生效（flip=-1）', f2a.flip === -1);
ok('雾仍压在眼前', f2a.fogOn && f2a.near < 30, 'near=' + f2a.near);
ok('墨仍糊着', (await ev(INK_PX)) > 100);

await sleep(1300);   // t≈2.6s：反向到期（2.0s）
const f2b = await ev(SNAP);
ok('2.6s 时反向已解除', f2b.flip === 1 && !f2b.invOn, 'flip=' + f2b.flip + ' on=' + f2b.invOn);
ok('2.6s 时雾和墨还在', !!(f2b.live.fog && f2b.live.ink), JSON.stringify(f2b.live));

await sleep(2200);   // t≈4.8s：全部到期
const f2c = await ev(SNAP);
ok('全部到期后没有任何残留', Object.keys(f2c.live).length === 0 && !f2c.fogOn && !f2c.invOn && !f2c.slowOn,
  JSON.stringify(f2c.live));

/* ============================ F3 雾回落到基线 ============================ */
console.log('\nF3 雾到期后回到天气本来的值');
await ev(`window.__PKITEMS.clearAllFx(); window.__PKITEMS._hit('fog', 900); true`);
await sleep(700);
const f3a = await ev(SNAP);
ok('生效中雾被压近', f3a.near < baseFog.near - 4, f3a.near + ' ← 基线 ' + baseFog.near);
for (let i = 0; i < 16; i++) { await sleep(300); if ((await ev(`window.__PKITEMS.state.fogMix`)) === 0) break; }
const f3b = await ev(SNAP);
ok('过期后 near 回到基线', Math.abs(f3b.near - baseFog.near) < 12,
  f3b.near + ' vs ' + baseFog.near + '（天气本身也会飘，给点余量）');
ok('fogMix 归零', f3b.mix === 0, 'mix=' + f3b.mix);

/* ============================ F4 生效中换图 ============================ */
console.log('\nF4 效果生效中换地图');
await ev(`window.__PKITEMS.clearAllFx(); window.__PKITEMS._hit('ink', 9000); window.__PKITEMS._hit('fog', 9000); true`);
const sceneBefore = await ev(`window.__game.Scene.id`);
// 别等黑场转场：传送门要先从 90m 外飞过来，8m/s 得十几秒，测的是耐心不是代码。
// 直接走同一条换图链路（swapTo → doSceneSwap），世界照样整个重建一遍。
await ev(`window.__game.setHomeTheme('city'); window.__game.resetScene(); true`);
await sleep(1800);
const sceneAfter = await ev(`window.__game.Scene.id`);
console.log('    地图:', sceneBefore, '→', sceneAfter);
ok('确实换图了', sceneAfter !== sceneBefore, sceneBefore + ' → ' + sceneAfter);
const f4 = await ev(SNAP);
ok('换图后墨还在（时间没到）', (await ev(INK_PX)) > 100, '像素=' + await ev(INK_PX));
ok('换图后雾还压着', f4.fogOn && f4.near < 40, 'near=' + f4.near + ' mix=' + f4.mix);
ok('画布只有一个', f4.canvases === 1, 'count=' + f4.canvases);
await shot('screenshots/fx-scene-swap.png');

/* ============================ F5 出局瞬间全清 ============================ */
console.log('\nF5 出局：墨/雾/反向不能留在等待屏上');
const f5a = await ev(SNAP);
ok('出局前确实还带着效果', Object.keys(f5a.live).length >= 2, JSON.stringify(f5a.live));
await ev(`window.__pkOnDie(); true`);
await sleep(700);
const f5 = await ev(SNAP);
const ph5 = await ev(`window.__PKVS_APP.phase`);
ok('已进入等待对手', ph5 === 'waiting', ph5);
ok('墨被擦干净', (await ev(INK_PX)) === 0, '像素=' + await ev(INK_PX));
ok('雾/反向/粘液的视觉类都摘了', !f5.fogOn && !f5.invOn && !f5.slowOn);
ok('fogMix 归零', f5.mix === 0, 'mix=' + f5.mix);
ok('等待阶段速度锁 0', (await ev(`window.__pkSpeedMul()`)) === 0);
await shot('screenshots/fx-after-die.png');

/* ============================ F6 计时赛时间到瞬间 ============================ */
console.log('\nF6 计时赛：时间到那一刻还糊着墨');
await ev(`window.__PKVS_APP.phase='idle'; window.__PKVS_APP.active=false; true`);
await sleep(300);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 778, startAtLocal: Date.now()+700,
  mode:'distance', options:{ matchMode:'t60' }, countdownMs:700 }); true`);
for (let i = 0; i < 25; i++) { await sleep(300); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
await sleep(300);
await ev(`window.__PKITEMS.clearAllFx();
  window.__PKITEMS._hit('ink', 9000); window.__PKITEMS._hit('invert', 9000); true`);
await sleep(400);
ok('开跑时效果在', (await ev(INK_PX)) > 100);
await ev(`window.__PKVS_APP.runStart = Date.now() - 59600; true`);   // 差 0.4s 到点
await sleep(1800);
const f6 = await ev(SNAP);
const ph6 = await ev(`window.__PKVS_APP.phase`);
ok('时间到 → 进入等待', ph6 === 'waiting', ph6);
ok('时间到瞬间墨被清掉', (await ev(INK_PX)) === 0, '像素=' + await ev(INK_PX));
ok('反向也解除', f6.flip === 1 && !f6.invOn);
const f6title = await ev(`(document.querySelector('#pkWait .t') || {}).textContent`);
ok('等待屏写「时间到」', f6title === '时间到', f6title);

/* ============================ F7 没打完就退出 ============================ */
console.log('\nF7 对局中途退出：菜单上不能糊着墨');
await ev(`window.__PKVS_APP.phase='idle'; window.__PKVS_APP.active=false; true`);
await sleep(300);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 555, startAtLocal: Date.now()+700,
  mode:'race', options:{ matchMode:'d3000' }, countdownMs:700 }); true`);
for (let i = 0; i < 25; i++) { await sleep(300); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
await sleep(300);
await ev(`window.__PKITEMS.clearAllFx();
  window.__PKITEMS._hit('ink', 9000); window.__PKITEMS._hit('fog', 9000); window.__PKITEMS._hit('invert', 9000); true`);
await sleep(500);
ok('退出前效果都在', (await ev(INK_PX)) > 100);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'phase', phase:'idle' }); true`);
await sleep(900);
const f7 = await ev(SNAP);
const menuState = await ev(`({ st: window.__game.S.state, phase: window.__PKVS_APP.phase,
  bodyCls: document.body.className })`);
console.log('    菜单:', JSON.stringify(menuState));
ok('回到菜单', menuState.st === 'menu' && menuState.phase === 'idle', JSON.stringify(menuState));
ok('菜单上没有墨', (await ev(INK_PX)) === 0, '像素=' + await ev(INK_PX));
ok('雾和反向都没跟过来', !f7.fogOn && !f7.invOn && f7.mix === 0, JSON.stringify({ fog: f7.fogOn, inv: f7.invOn, mix: f7.mix }));
ok('键盘方向恢复正常', (await ev(`window.__pkInputFlip()`)) === 1);
await shot('screenshots/fx-after-leave.png');

// 退出对战只是回到大厅（大厅是覆盖层，还盖在菜单上），这时候锁键盘是对的
// —— 它里面有昵称 / 信令码输入框。真正要查的是「关掉大厅之后锁有没有解开」，
// 那个才是会让人以为游戏坏了的 bug（整局按方向键没反应）。
const lockInLobby = await ev(`window.__pkInputLock()`);
await ev(`document.getElementById('pkVsBack').click(); true`);
await sleep(700);
const afterBack = await ev(`({ lock: window.__pkInputLock(),
  disp: document.getElementById('pk-root').style.display, st: window.__game.S.state })`);
console.log('    大厅内 lock=' + lockInLobby + '，关掉后', JSON.stringify(afterBack));
ok('大厅开着时锁键盘（留给输入框）', lockInLobby === true, 'lock=' + lockInLobby);
ok('关掉大厅后键盘解锁', afterBack.lock === false, 'lock=' + afterBack.lock);
ok('大厅面板收掉了', afterBack.disp === 'none', 'display=' + afterBack.disp);
// 下一节还要开局，把大厅重新叫出来
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);


/* ============================ F8 反复命中不堆 DOM ============================ */
// 上一节已经回到菜单了，里程不会涨。F8/F9 要真跑，先开一局新的。
console.log('\n— 开一局新的（默认 3000m）—');
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 313, startAtLocal: Date.now()+700,
  mode:'race', options:{ matchMode:'d3000' }, countdownMs:700 }); true`);
for (let i = 0; i < 25; i++) { await sleep(300); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
ok('新一局已开跑', (await ev(`window.__PKVS_APP.phase`)) === 'run');
await ev(hideStaleCd);
await sleep(600);

// 生效中的墨不该挡住「吃到道具」的提示牌（8460 > 8400），
// 也不该让吃盲盒这件事失效 —— 被糊住视野的时候照样能捡到盒子
await ev(`window.__PKITEMS._hit('ink', 4000); true`);
await sleep(300);
const f8pick = await ev(`(() => {
  const st = window.__sent.length;
  window.__PKITEMS.pick('box');
  const el = document.getElementById('pkPickFx');
  return { sent: window.__sent.length - st, evil: window.__PKITEMS.state.evil,
           on: !!el && el.className.indexOf('on') >= 0,
           z: el ? +getComputedStyle(el).zIndex : 0,
           inkZ: +getComputedStyle(document.getElementById('pkInkFx')).zIndex };
})()`);
ok('墨糊着的时候吃盲盒也正常', f8pick.on === true, JSON.stringify({ sent: f8pick.sent, evil: f8pick.evil }));
ok('提示牌压在墨上面', f8pick.z > f8pick.inkZ, 'z=' + f8pick.z + ' > ' + f8pick.inkZ);
await sleep(1200);

console.log('\nF8 连续命中 12 次不堆画布');
const domBefore = await ev(`({ ink: document.querySelectorAll('#pkInkFx').length,
  throwfx: document.querySelectorAll('#pkThrowFx').length })`);
for (let i = 0; i < 12; i++) await ev(`window.__PKITEMS._hit('ink', 1200); true`);
await sleep(700);
const domMid = await ev(`({ ink: document.querySelectorAll('#pkInkFx').length,
  throwfx: document.querySelectorAll('#pkThrowFx').length })`);
console.log('    之前', JSON.stringify(domBefore), '之后', JSON.stringify(domMid));
ok('画布始终只有一个', domMid.ink === 1, 'count=' + domMid.ink);
ok('墨在播放中（12 次刷新后仍可见）', (await ev(INK_PX)) > 100);
await sleep(2000);
ok('最后一次到期后清空', (await ev(INK_PX)) === 0, '像素=' + await ev(INK_PX));

/* ============================ F9 减速真的算进里程 ============================ */
console.log('\nF9 粘液减速对实际速度的影响');
await ev(`window.__PKITEMS.clearAllFx(); true`);
const d0 = await ev(`window.__game.S.D`);
await sleep(1400);
const d1 = await ev(`window.__game.S.D`);
await ev(`window.__PKITEMS._hit('slow', 2600); true`);
await sleep(200);
const d2 = await ev(`window.__game.S.D`);
await sleep(1400);
const d3 = await ev(`window.__game.S.D`);
const rateN = (d1 - d0) / 1.4, rateS = (d3 - d2) / 1.4;
console.log('    正常 ' + rateN.toFixed(2) + ' m/s，减速 ' + rateS.toFixed(2) + ' m/s，比值 ' + (rateS / Math.max(0.01, rateN)).toFixed(2));
ok('减速时里程增速明显变慢', rateS < rateN * 0.75, (rateS / Math.max(0.01, rateN)).toFixed(2) + '（设计 0.40）');
await ev(`window.__PKITEMS.clearAllFx(); true`);

/* ============================ F10 同类重复命中不叠加 ============================ */
console.log('\nF10 同种效果重复命中');
await ev(`window.__PKITEMS.clearAllFx(); true`);
const r1 = await ev(`JSON.stringify(window.__PKITEMS._hit('fog', 3000))`);
await sleep(300);
const r2 = await ev(`JSON.stringify(window.__PKITEMS._hit('fog', 3000))`);
const left = await ev(`Math.round(window.__PKITEMS.state.hits.fog - performance.now())`);
console.log('    第一次', r1, '第二次', r2, '剩余', left);
ok('第二次标 again', JSON.parse(r2).again === true, r2);
ok('时长不叠加（≈3.0s 而不是 5.7s）', left > 2600 && left < 3200, left + 'ms');
ok('雾的视觉只有一层', (await ev(`document.querySelectorAll('#pkFxFog').length`)) === 1);

/* ============================ F11 重开一局不带残留 ============================ */
console.log('\nF11 end() → begin()：上一局的效果不能进下一局');
await ev(`window.__PKITEMS.clearAllFx();
  window.__PKITEMS._hit('ink', 9000); window.__PKITEMS._hit('slow', 9000);
  window.__PKITEMS._hit('fog', 9000); window.__PKITEMS._hit('invert', 9000); true`);
await sleep(400);
await ev(`window.__PKITEMS.end(); true`);
await sleep(300);
const f11a = await ev(SNAP);
ok('end() 之后立刻干净', (await ev(INK_PX)) === 0 && f11a.mix === 0 && f11a.flip === 1 && f11a.mul === 1);
await ev(`window.__PKITEMS.begin(99); true`);
await sleep(300);
const f11b = await ev(SNAP);
ok('begin() 之后也是干净的', Object.keys(f11b.live).length === 0 && f11b.mix === 0 && (await ev(INK_PX)) === 0,
  JSON.stringify(f11b.live));
ok('begin() 后计数归零', (await ev(`window.__PKITEMS.state.picked`)) === 0 && (await ev(`window.__PKITEMS.state.evil`)) === 0);

/* ============================ F12 生效中改窗口 ============================ */
console.log('\nF12 墨在播的时候转屏');
await ev(`window.__PKITEMS.clearAllFx(); window.__PKITEMS._hit('ink', 6000); true`);
await sleep(500);
await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(700);
const cv = await ev(`(() => { const c = document.getElementById('pkInkFx');
  return c ? [c.width, c.height, innerWidth, innerHeight] : null; })()`);
ok('画布跟上新尺寸', cv && Math.abs(cv[0] - cv[2]) <= 2 && Math.abs(cv[1] - cv[3]) <= 2, JSON.stringify(cv));
ok('竖屏下墨仍然可见', (await ev(INK_PX)) > 100);
await shot('screenshots/fx-ink-portrait.png');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await sleep(400);
ok('转回横屏后画布跟上', Math.abs((await ev(`document.getElementById('pkInkFx').width`)) - 1100) <= 2);

/* ============================ F13 生效中吃复活币 ============================ */
// 唯一一条「效果还在、但游戏状态被打断」的路径：die() 里 revives>0 会直接
// useRevive()，不走 __pkOnDie，所以不会 report、不会清效果。
console.log('\nF13 带着墨和雾吃复活币');
await ev(`window.__game.S.revives = 1; window.__game.S.diedTurnAt = null;
  window.__game.S.transGrace = 0; true`);
await ev(`window.__PKITEMS.clearAllFx();
  window.__PKITEMS._hit('ink', 6000); window.__PKITEMS._hit('fog', 6000); true`);
await sleep(400);
const dieRes = await ev(`(() => {
  const g = window.__game, before = g.S.revives;
  g.die('测试');
  return { before, after: g.S.revives, state: g.S.state };
})()`);
await sleep(600);
const f13 = await ev(SNAP);
const f13phase = await ev(`({ phase: window.__PKVS_APP.phase, reported: !!window.__PKVS_APP.reported })`);
console.log('    die →', JSON.stringify(dieRes), 'phase', JSON.stringify(f13phase));
ok('复活币被消耗且当场复活', dieRes.before === 1 && dieRes.after === 0 && dieRes.state === 'playing', JSON.stringify(dieRes));
ok('没有判负（还在打）', f13phase.phase === 'run' && f13phase.reported === false, JSON.stringify(f13phase));
ok('复活后墨仍在（按时间走，不因复活清空）', (await ev(INK_PX)) > 100, '像素=' + await ev(INK_PX));
ok('画布没有重复创建', f13.canvases === 1, 'count=' + f13.canvases);
ok('复活后速度恢复正常（没被冻结）', (await ev(`window.__pkSpeedMul()`)) === 1, String(await ev(`window.__pkSpeedMul()`)));
await shot('screenshots/fx-revive.png');

// 收尾：再死一次，这次没复活币了，应当立刻判负并清干净
await ev(`window.__pkOnDie(); true`);
await sleep(600);
ok('没复活币时立刻判负并清墨', (await ev(`window.__PKVS_APP.phase`)) === 'waiting' && (await ev(INK_PX)) === 0);

/* ============================ 汇总 ============================ */
await ev(`window.__PKITEMS.end(); true`);
const bad = R.filter(x => !x[1]);
console.log('\n================ 汇总 ================');
console.log('通过 ' + (R.length - bad.length) + '/' + R.length);
if (bad.length) bad.forEach(b => console.log('  ✗ ' + b[0]));
console.log('控制台异常：', caught.length ? caught.slice(0, 6) : '无');
process.exit(bad.length ? 1 : 0);
