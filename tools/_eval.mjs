// 取一次页面状态（任意表达式），用于快速排查
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXPR = process.argv[2] || '1';
const THEME = process.argv[3] || 'campus';
const ARC = process.argv[4] || '1450';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 60000) => { const id = ++seq; const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result)))); ws.send(JSON.stringify({ id, method: m, params: p })); return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-real.html')).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=high&theme=${THEME}&v=${stamp}` }, 90000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game === "object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => 0)) break; await sleep(300); }
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = false; window.__wx.setTime(0.36); window.__game.CAMPUS.s = ${ARC}; window.__game.CAMPUS.jIdx = 0; true`);
await sleep(900);
console.log(await ev(EXPR));
process.exit(0);
