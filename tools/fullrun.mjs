// ============================================================================
//  fullrun.mjs —— 校园整段自动跑通（无敌 + 自动按对方向），验证没有死路/异常
//  用法： node tools/fullrun.mjs [--theme=campus] [--dist=3400]
// ============================================================================
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const THEME = val('--theme', 'campus');
const DIST = +val('--dist', '3400');
const FILE = val('--file', '.perf-real.html');

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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        caught.push('ERR: ' + m.params.args.map(a => a.description || a.value).join(' ').slice(0, 200));
});
const send = (m, p = {}, tmo = 180000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 180000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=low&theme=${THEME}&v=${Date.now()}` }, 150000);
for (let i = 0; i < 240; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break; await sleep(300); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(600);

const out = await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  G.Scene.fanfareDone = true;      // 跳过谢幕环绕，直接测转场
  const log = []; let pressed = false, frames = 0, deaths = 0;
  const target = G.S.D + ${DIST};
  const t0 = performance.now();
  while (G.S.D < target && frames < 60 * 420) {
    G.S.transGrace = 99;                 // 无敌：只验几何与判定，不验躲避
    G.Scene.fanfareDone = true;
    const j = C.junctions[C.jIdx];
    const dist = C.nextAbs - C.s;
    if (j && !pressed && dist > 0 && dist <= 9) {
      C.pendingDir = j.dir === 'L' ? -1 : 1; C.pendingAt = C.s; pressed = true;
    }
    const before = C.jIdx, sceneBefore = G.Scene.id;
    G.step(1 / 60);
    frames++;
    if (C.jIdx !== before) {
      log.push({ at: Math.round(C.s), ok: C.lastTurn && C.lastTurn.fresh, need: C.lastTurn && C.lastTurn.need, state: G.S.state });
      pressed = false;
    }
    if (G.S.state !== 'playing') { deaths++; log.push({ DEAD: G.S.lastDeathCause, at: Math.round(C.s) }); break; }
    if (G.Scene.id !== sceneBefore) { log.push({ scene: sceneBefore + '->' + G.Scene.id, at: Math.round(C.s) }); break; }
  }
  return { frames, ms: Math.round(performance.now() - t0), D: Math.round(G.S.D), s: Math.round(C.s),
           deaths, scene: G.Scene.id, log, theta: +(C.theta * 180 / Math.PI).toFixed(1) };
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
