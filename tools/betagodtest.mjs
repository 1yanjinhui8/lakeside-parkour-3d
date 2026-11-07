// 内测版无敌回归：die() 直接调用 + 真实转向判负都必须被挡
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = list.find(t => t.type === 'page' && t.url.includes('127.0.0.1:' + PORT_HTTP));
if (!page) {
    for (const t of list.filter(x => x.type === 'page')) await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => { });
    page = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 45000) => {
    const id = ++seq;
    const pr = new Promise(a => pend.set(id, a));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 45000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.result?.value;

console.log('[1] cdp ok');
await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-beta.html')).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-beta.html?autostart&q=high&theme=campus2&t=0.33&v=${stamp}` }, 180000);
console.log('[2] navigating');
let up = false;
for (let i = 0; i < 400; i++) {
    up = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS_SETS && !!window.__game.player').catch(() => false);
    if (up) break;
    await sleep(300);
}
if (!up) { console.log('页面没起来'); process.exit(1); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = false; true');
await sleep(1200);

// ① 直接调 die：应被挡
const r1 = await ev(`(()=>{const G=window.__game;G.die('测试·直接死');return JSON.stringify({state:G.S.state})})()`);
console.log('① 直接 die →', r1, r1.includes('"playing"') ? '✅' : '❌');

// ② 真实转向判负：把玩家放到医学部第一个路口前 2m、不按方向，跨过去
const r2 = await ev(`(async()=>{
  const G=window.__game,C=G.CAMPUS;
  C.s = C.junctions[0].at - 2; C.jIdx = 0; C.jLap = 0;
  C.nextAbs = C.junctions[0].at; C.pendingDir = 0;
  G.S.state='playing'; G.S.transGrace=0; G.S.flying=false;
  for (const o of G.obstacles) { o.z = 1e6; o.mesh.visible = false; }
  await new Promise(r=>setTimeout(r,1500));
  return JSON.stringify({state:G.S.state, s:Math.round(C.s), lastTurn:C.lastTurn||null});
})()`);
console.log('② 不按方向过路口 →', r2);
const ok2 = r2.includes('"playing"');
console.log(ok2 ? '✅ 转向判负被无敌挡住' : '❌ 还是死了');

console.log('控制台:', logs.filter(l => l.includes('beta')).slice(-3).join(' | '));
process.exit(ok2 && r1.includes('"playing"') ? 0 : 1);
