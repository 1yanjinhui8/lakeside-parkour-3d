// 墨水效果的快速视觉迭代：不进对局，直接 begin + _hit('ink') 截图
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = +(process.argv[2] || 9222);
const scene = (process.argv[3] || 'city');
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
for (const t of list.filter(x => x.type === 'page')) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 120000) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }); const s = r.result || r; fs.writeFileSync(f, Buffer.from(s.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8765/.perf-real.html?q=low&theme=${scene}&autostart&v=${Date.now()}` }, 120000);
for (let i = 0; i < 120; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__PKITEMS')) break; await sleep(400); }
await ev(`window.__game.S.transGrace = 9999; true`);
await sleep(2200);
console.log('ready', await ev('window.__game.S.state'), 'D', await ev('Math.round(window.__game.S.D)'));
await ev(`window.__PKITEMS.begin(); window.__PKITEMS._hit('ink', 3600); true`);
let acc = 0;
for (const [i, d] of [[1, 450], [2, 800], [3, 900], [4, 900]]) {
  await sleep(d); acc += d;
  await shot(`screenshots/ink-t${i}.png`);
  console.log('shot ink-t' + i, 'el=', acc);
}
process.exit(0);
