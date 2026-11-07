// ============================================================================
//  mode-test.mjs —— 对局模式 + 盲盒负面收益
//  单页灌 matchStart 事件，逐个验证 6 种模式的结束条件和判定方式，
//  再统计盲盒「开出负面」的实际比例与效果落点（是不是真的打自己）。
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
await send('Page.bringToFront', {}).catch(() => { });
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => { });
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8765/.perf-real.html?q=low&v=${Date.now()}` }, 120000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__PKITEMS')) break; await sleep(400); }

const R = [];
const ok = (n, pass, extra) => { R.push([n, !!pass]); console.log((pass ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : '')); };

/* ===================== A. 盲盒负面收益 ===================== */
console.log('\nA 盲盒负面收益');
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);
await ev(`(() => { const lb = window.__PKVS_APP.lobby; window.__sent = [];
  lb.sendGameEvent = function (t, d) { window.__sent.push([t, d]); return true; }; return true; })()`);

const stat = await ev(`(() => {
  const I = window.__PKITEMS;
  I.begin(20261102);
  I.state.lobby = window.__PKVS_APP.lobby;
  let evil = 0, good = 0, sentWhenEvil = 0;
  const before = window.__sent.length;
  for (let i = 0; i < 400; i++) {
    I.state.evil = 0;
    const s0 = window.__sent.length;
    I.pick('box');
    if (I.state.evil > 0) { evil++; if (window.__sent.length > s0) sentWhenEvil++; }
    else good++;
  }
  I.clearAllFx();
  return { evil, good, sentWhenEvil, total: 400, sentAll: window.__sent.length - before };
})()`);
console.log('    ', JSON.stringify(stat));
const rate = stat.evil / stat.total;
// EVIL_RATE 现在是 0.20：400 次抽样的标准差约 2%，给到 13%~30% 足够稳
ok('负面比例在 13%~30%', rate > 0.13 && rate < 0.30, (rate * 100).toFixed(1) + '%');
ok('正面确实占多数', stat.good > stat.evil, stat.good + ' 正 / ' + stat.evil + ' 负');
ok('开出负面时不发给对手', stat.sentWhenEvil === 0, '误发 ' + stat.sentWhenEvil + ' 次');
ok('开出正面都会发 attack', stat.sentAll === stat.good, stat.sentAll + ' 条 / ' + stat.good + ' 次正面');

// 负面效果确实落在自己身上
const selfHit = await ev(`(() => {
  const I = window.__PKITEMS;
  I.begin(7); I.state.lobby = window.__PKVS_APP.lobby;
  I.clearAllFx();
  const t0 = performance.now();
  // 强制走负面分支：把 EVIL_RATE 顶到 1 不方便，直接连抽到出现一次负面为止
  for (let i = 0; i < 40; i++) {
    I.state.evil = 0;
    I.pick('box');
    if (I.state.evil > 0) {
      const hits = Object.keys(I.state.hits).filter(k => I.state.hits[k] > performance.now());
      return { hitOnSelf: hits.length > 0, hits, ms: hits.length ? Math.round(I.state.hits[hits[0]] - t0) : 0 };
    }
  }
  return { hitOnSelf: false, hits: [] };
})()`);
console.log('    ', JSON.stringify(selfHit));
ok('负面效果打在自己身上', selfHit.hitOnSelf === true, JSON.stringify(selfHit.hits));
ok('负面时长比正面短（<3.6s）', selfHit.ms > 0 && selfHit.ms <= 2600, selfHit.ms + 'ms');

/* ===================== B. 六种模式 ===================== */
console.log('\nB 六种模式的参数');
const MODES = [
  ['d1000', 'distance', 1000],
  ['d2000', 'distance', 2000],
  ['d3000', 'distance', 3000],
  ['t60', 'time', 60000],
  ['t120', 'time', 120000],
  ['t180', 'time', 180000],
];
for (const [mid, kind, val] of MODES) {
  await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 99, startAtLocal: Date.now()+700,
    mode: ${JSON.stringify(kind === 'time' ? 'distance' : 'race')}, options: { matchMode: ${JSON.stringify(mid)} }, countdownMs: 700 }); true`);
  await sleep(180);
  const st = await ev(`({ id: window.__PKVS_APP.modeId, kind: window.__PKVS_APP.modeKind,
    goal: window.__PKVS_APP.goal, dur: window.__PKVS_APP.durationMs,
    lobbyGoal: window.__PKVS_APP.lobby.goal, limit: window.__PKVS_APP.lobby.race && window.__PKVS_APP.lobby.race.timeLimit })`);
  const pass = kind === 'distance'
    ? (st.kind === 'distance' && st.goal === val && st.dur === 0)
    : (st.kind === 'time' && st.dur === val && st.goal > 800);
  ok(mid + ' → ' + (kind === 'distance' ? val + 'm' : val / 1000 + 's'), pass, JSON.stringify(st));
  // 退出当前这局，免得影响下一轮
  await ev(`window.__PKVS_APP.phase = 'idle'; window.__PKVS_APP.active = false; true`);
  await sleep(120);
}

/* ===================== C. 结束条件 ===================== */
console.log('\nC 结束条件');
// 距离赛：跑到 goal 就结束
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 5, startAtLocal: Date.now()+600,
  mode:'race', options:{ matchMode:'d2000' }, countdownMs:600 }); true`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
// 站到终点前一点点就行：headless 只有 15fps，1.2 秒才跑 9 米，设 1990 会差 1 米判不出来
await ev(`window.__game.S.transGrace = 99999; window.__game.S.D = 1996; true`);
await sleep(2200);
const d2k = await ev(`({ phase: window.__PKVS_APP.phase, reported: window.__PKVS_APP.reported, D: Math.round(window.__game.S.D) })`);
ok('d2000 跑到 2000m 结束', d2k.phase === 'waiting' && d2k.reported === true, JSON.stringify(d2k));

await ev(`window.__PKVS_APP.phase = 'idle'; window.__PKVS_APP.active = false; true`);
await sleep(200);

// 计时赛：时间到就结束（把 runStart 往前推，免得真等 60 秒）
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 6, startAtLocal: Date.now()+600,
  mode:'distance', options:{ matchMode:'t60' }, countdownMs:600 }); true`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
await sleep(600);
const midRun = await ev(`({ phase: window.__PKVS_APP.phase, dur: window.__PKVS_APP.durationMs, D: Math.round(window.__game.S.D) })`);
ok('t60 开跑时还没结束', midRun.phase === 'run' && midRun.dur === 60000, JSON.stringify(midRun));

// 把开局时刻往前推 59.5 秒 → 半秒后判时间到
await ev(`window.__PKVS_APP.runStart = Date.now() - 59500; true`);
await sleep(1500);
const t60 = await ev(`({ phase: window.__PKVS_APP.phase, reported: window.__PKVS_APP.reported,
  wait: (document.getElementById('pkWait') || {}).className, title: (document.querySelector('#pkWait .t') || {}).textContent,
  sub: (document.querySelector('#pkWait .s') || {}).textContent })`);
console.log('    ', JSON.stringify(t60));
ok('t60 时间到就结束', t60.phase === 'waiting' && t60.reported === true, t60.phase);
ok('等待屏写「时间到」', t60.title === '时间到', t60.title);
ok('等待屏显示跑了多少米', String(t60.sub || '').indexOf('跑了') >= 0, t60.sub);
await shot('screenshots/mode-timeup.png');

const bad = R.filter(x => !x[1]);
console.log('\n================ 汇总 ================');
console.log('通过 ' + (R.length - bad.length) + '/' + R.length);
if (bad.length) bad.forEach(b => console.log('  ✗ ' + b[0]));
console.log('控制台异常：', caught.length ? caught.slice(0, 5) : '无');
process.exit(bad.length ? 1 : 0);
