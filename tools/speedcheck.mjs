// ============================================================================
//  speedcheck.mjs —— 校园里程推进速率（C.s 应该和 S.D 同步，不能是 2 倍）
// ============================================================================
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo'); })]);
};
const ev = async (e, tmo = 60000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result?.value;
};
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=low&theme=campus&v=${Date.now()}` }, 120000);
for (let i = 0; i < 240; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break; await sleep(300); }
const out = await ev(`(async () => {
  const G = window.__game;
  G.startGame(); G.QUALITY.adaptive = false;
  await new Promise(r => setTimeout(r, 800));
  const a = { D: G.S.D, s: G.CAMPUS.s, t: performance.now() };
  await new Promise(r => setTimeout(r, 2000));
  const b = { D: G.S.D, s: G.CAMPUS.s, t: performance.now() };
  const dD = b.D - a.D, dS = b.s - a.s;
  return { dD: +dD.toFixed(2), dS: +dS.toFixed(2), ratio: +(dS / dD).toFixed(3),
           kmh: +(dD / ((b.t - a.t) / 1000) * 3.6).toFixed(1),
           platesLoaded: G.CAMPUS_SETS.campus.ready, dc: G.renderer.info.render.calls,
           mem: G.renderer.info.memory };
})()`);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
