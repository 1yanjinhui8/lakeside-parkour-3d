// 赛道道具特写：进对局 → 刷一个道具 → 拉到镜头前截图
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +(process.argv[2] || 9222);
const KIND = process.argv[3] || '';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
  await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
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
await ev(`window.__PKVS_API.openLobby(); true`);
await sleep(400);
await ev(`window.__PKVS_APP.lobby.onVSEvent({ type:'matchStart', seed: 20261101, startAtLocal: Date.now()+900, mode:'race', countdownMs:900 }); true`);
for (let i = 0; i < 25; i++) { await sleep(400); if (await ev(`window.__PKVS_APP.phase`) === 'run') break; }
await ev(`window.__game.S.transGrace = 99999; true`);
await sleep(1800);

// 刷一个（可以指定类型）
await ev(`window.__PKITEMS._setNext(window.__game.S.D + 26); true`);
await sleep(800);
const types = await ev(`window.__game.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0).map(p => p.type)`);
console.log('on track:', JSON.stringify(types));

// 全部拉到镜头前，排成一排好一次看清
await ev(`window.__K = ${JSON.stringify(KIND)}; true`);
await ev(`(() => {
  const G = window.__game;
  const ps = G.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0);
  // 顺手补几个不同类型，方便一张图看全
  const want = ['pk_ink','pk_slow','pk_fog','pk_invert'];
  const have = new Set(ps.map(p => p.type));
  const S = G.S;
  want.forEach((t, i) => {
    if (have.has(t)) return;
    G.placePowerUp(i % 3, S.D + 8 + i * 1.6, t);
  });
  return true;
})()`);
await sleep(200);
await ev(`window.__K = ${JSON.stringify(KIND)}; true`);
await ev(`(() => {
  const G = window.__game;
  const ps = G.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0);
  // 只留一个，贴到镜头前，好数清像素
  const keep = ps.filter(p => p.type === 'pk_' + (window.__K || 'ink'));
  const one = (keep.length ? keep : ps)[0];
  ps.forEach(p => { if (p !== one) { G.scene.remove(p.mesh); } });
  if (one) { one.z = -11; one.x = -2.4; }
  G.S.x = 0; G.S.lane = 1;
  return one ? one.type : null;
})()`);
await sleep(120);
await shot('screenshots/pick-closeup.png');
console.log('shot ok');
process.exit(0);
