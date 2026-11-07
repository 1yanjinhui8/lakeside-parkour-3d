// ============================================================================
//  item-test.mjs —— 干扰道具（赛道拾取版）端到端
//  单页跑：进对局 → 等赛道刷出 pk_ 道具 → 把玩家挪到它身上 → 吃 → 检查事件
//  再验四种效果、HUD 收尾。跨端一致性交给 pvp-test。
// ============================================================================
import fs from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +(process.argv[2] || 9222);
const FILE = '.perf-real.html';

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
// headless 下新标签页会被判成不可见 → rAF 停摆 → 倒计时根本不走。
// 单页测试也会中招，不只是双人那边。
await send('Page.bringToFront', {}).catch(() => { });
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => { });
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8765/${FILE}?q=low&v=${Date.now()}` }, 120000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__PKITEMS')) break; await sleep(400); }

const R = [];
const ok = (n, pass, extra) => { R.push([n, !!pass]); console.log((pass ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : '')); };

/* ---------------- 进对局 ---------------- */
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);
await ev(`(() => { const lb = window.__PKVS_APP.lobby; window.__sent = [];
  lb.sendGameEvent = function (t, d) { window.__sent.push([t, d]); return true; }; return true; })()`);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 20261101, startAtLocal: Date.now()+1200, mode:'race', countdownMs:1200 }); true`);
for (let i = 0; i < 25; i++) { await sleep(400); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
const phase1 = await ev(`window.__PKVS_APP.phase`);
if (phase1 !== 'run') {
  console.log('  诊断:', JSON.stringify(await ev(`(() => { const A = window.__PKVS_APP;
    return { phase: A.phase, startAt: A.startAt, now: Date.now(), remain: A.startAt ? A.startAt - Date.now() : null,
             vis: document.visibilityState, gameState: window.__game.S.state, D: Math.round(window.__game.S.D),
             lobbyScreen: A.lobby && A.lobby.screen }; })()`)));
}
ok('进入对局', phase1 === 'run', phase1);

/* ---------------- 赛道刷道具 ---------------- */
console.log('\n— 赛道生成 —');
await ev(`window.__PKITEMS._setNext(window.__game.S.D + 40); true`);
await sleep(900);
const spawned = await ev(`(() => {
  const ps = window.__game.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0);
  return ps.map(p => ({ type: p.type, x: +p.x.toFixed(2), z: +p.z.toFixed(1), y: +p.y.toFixed(2) }));
})()`);
ok('赛道上出现 pk_ 道具', spawned && spawned.length > 0, JSON.stringify(spawned));
ok('道具已登记进 CONFIG.powerUps', (await ev(`['pk_ink','pk_slow','pk_fog','pk_invert'].every(k => !!window.__game.CONFIG.powerUps[k])`)) === true);
ok('赛道上只有盲盒（不剧透）', spawned && spawned.every(p => p.type === 'pk_box'),
  spawned && spawned.map(p => p.type).join(','));
await shot('screenshots/pick-track.png');

/* ---------------- 拾取 → 发事件 ---------------- */
console.log('\n— 吃掉并打向对手 —');
// 光改 S.x 不够：S.lane 没变的话，下一帧插值会把 x 拽回中线，dx 一下就超出判定半径。
// 低帧率时 dt 大、拽得更狠，必须连 lane 一起改。
await ev(`(() => {
  const G = window.__game, S = G.S;
  const ps = G.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0);
  if (!ps.length) return null;
  const p = ps[0];
  S.lane = p.x > 1 ? 2 : (p.x < -1 ? 0 : 1);
  S.x = p.x;
  p.z = -0.4;          // 前方 0.4m，下一帧滚到身上，还在判定半径里
  return { type: p.type, lane: S.lane, x: p.x };
})()`);
await sleep(900);
const afterPick = await ev(`({
  picked: window.__PKITEMS.state.picked,
  sent: window.__sent.filter(x => x[0] === 'attack').length,
  kind: (window.__sent.find(x => x[0] === 'attack') || [])[1] ? window.__sent.find(x => x[0] === 'attack')[1].kind : null,
  stillOnTrack: window.__game.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0).length,
  flash: (document.getElementById('pkPickFx') || {}).className,
  msg: (document.getElementById('pkPickFx') || {}).textContent
})`);
console.log('    ', JSON.stringify(afterPick));
ok('吃到了（picked=1）', afterPick && afterPick.picked === 1, 'picked=' + (afterPick && afterPick.picked));
ok('发出 1 条 attack', afterPick && afterPick.sent === 1, 'sent=' + (afterPick && afterPick.sent));
ok('开出的是四种之一', afterPick && ['ink', 'slow', 'fog', 'invert'].includes(afterPick.kind), afterPick && afterPick.kind);
ok('道具从赛道消失', afterPick && afterPick.stillOnTrack === 0, 'left=' + (afterPick && afterPick.stillOnTrack));
ok('中央提示弹出并写「开出」', afterPick && String(afterPick.flash).indexOf('on') >= 0
  && String(afterPick.msg).indexOf('开出') >= 0, afterPick && afterPick.msg);
await shot('screenshots/pick-flash.png');

/* ---------------- 四种效果 ---------------- */
console.log('\n— 四种效果 —');
const r1 = await ev(`JSON.stringify(window.__PKITEMS._hit('ink', 3600))`);
ok('墨水命中', JSON.parse(r1).kind === 'ink', r1);
await sleep(600);
ok('墨水 canvas 起来', (await ev(`!!document.getElementById('pkInkFx')`)) === true);
await shot('screenshots/pick-ink.png');

await ev(`JSON.stringify(window.__PKITEMS._hit('slow', 2600))`);
await sleep(300);
ok('粘液减速 0.40', (await ev(`window.__pkSpeedMul()`)) === 0.4, String(await ev(`window.__pkSpeedMul()`)));

await ev(`JSON.stringify(window.__PKITEMS._hit('fog', 4000))`);
await sleep(1600);
// fogAura 每帧只收敛 16%，headless 软渲染帧率低时会明显更慢；判「被明显压低」而不是等号
const fogNow = await ev(`({ near: +window.__game.scene.fog.near.toFixed(1), far: +window.__game.scene.fog.far.toFixed(1),
  mix: +window.__PKITEMS.state.fogMix.toFixed(2) })`);
ok('冷凝雾把雾压到眼前', fogNow.near < 20 && fogNow.far < 80,
  'near=' + fogNow.near + ' far=' + fogNow.far + ' mix=' + fogNow.mix + '（目标 6 / 40）');

await ev(`JSON.stringify(window.__PKITEMS._hit('invert', 4000))`);
await sleep(200);
ok('反向 flip=-1', (await ev(`window.__pkInputFlip()`)) === -1);
// 先归到中间道：站在最右道时按左键反转后仍被 clamp 在 2，等于什么都没验证
await ev(`window.__game.S.lane = 1; window.__game.S.x = 0; true`);
await sleep(220);
const l0 = await ev(`window.__game.S.lane`);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); true`);
await sleep(220);
const l1 = await ev(`window.__game.S.lane`);
ok('按 ← 实际往右', l0 === 1 && l1 === 2, l0 + ' → ' + l1);

/* ---------------- 同类不叠加 ---------------- */
console.log('\n— 同类重复命中 —');
const dup = await ev(`(() => { const r = window.__PKITEMS._hit('invert', 4000);
  return { again: r.again }; })()`);
ok('重复命中标记 again', dup && dup.again === true, JSON.stringify(dup));

/* ---------------- HUD / 收尾 ---------------- */
console.log('\n— HUD 与收尾 —');
ok('道具槽已隐藏', (await ev(`(() => { const b = document.getElementById('pkAttack'); if (!b) return 'none';
  return getComputedStyle(b).display; })()`)) === 'none');
ok('暂停按钮已隐藏', (await ev(`getComputedStyle(document.getElementById('pauseBtn')).display`)) === 'none');
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchEnd', reason:'finish' }); true`);
await sleep(600);
const end = await ev(`(() => { const cv = document.getElementById('pkInkFx'); let inkPx = 0;
  if (cv && cv.width) { const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    for (let i=3;i<d.length;i+=4*61) if (d[i]>8) inkPx++; }
  return { alive: window.__PKITEMS.state.alive, inkPx, mix: window.__PKITEMS.state.fogMix }; })()`);
ok('结算后墨擦干净', end && end.inkPx === 0 && end.mix === 0, JSON.stringify(end));

const bad = R.filter(x => !x[1]);
console.log('\n================ 汇总 ================');
console.log('通过 ' + (R.length - bad.length) + '/' + R.length);
if (bad.length) bad.forEach(b => console.log('  ✗ ' + b[0]));
console.log('控制台异常：', caught.length ? caught.slice(0, 5) : '无');
process.exit(bad.length ? 1 : 0);
