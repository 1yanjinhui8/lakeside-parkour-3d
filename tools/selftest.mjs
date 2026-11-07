import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const FILE = (process.argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || '.perf-real.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') caught.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300));
});
const send = (m, p = {}, tmo = 240000) => { const id = ++seq;
  const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
  ws.send(JSON.stringify({ id, method: m, params: p }));
  return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async (e, tmo = 240000) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result?.value; };
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
// 不禁用缓存：three 走 CDN，禁缓存后无头环境偶尔抓不到（会报 importmap 拉取失败）
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?q=low&v=${Date.now()}` }, 150000);
for (let i = 0; i < 240; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(300); }
const r = await ev('(() => { const t = window.__game.selfTest(); return { pass: t.pass, fail: t.fail, total: t.total, bad: t.results.filter(x => !x.pass).map(x => x.name + " | " + (x.detail||"")) }; })()');
console.log(JSON.stringify(r, null, 1));
console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
