// ============================================================================
//  turnprobe.mjs —— 转向判定实跑：每到路口按提示方向打方向，记录判定结果
//  用法： node tools/turnprobe.mjs [--from=1300] [--to=2200] [--press=30]
// ============================================================================
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FROM = +val('--from', '1300'), TO = +val('--to', '2200'), PRESS = +val('--press', '30');

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
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 120000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=low&theme=campus&v=${Date.now()}` }, 120000);
for (let i = 0; i < 240; i++) {
    if (await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break;
    await sleep(300);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(800);

const out = await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  G.S.state = 'playing'; G.Scene.phase = 'run'; G.Scene.segEnd = 1e9; G.Scene.next = 'lakeside';
  C.s = ${FROM}; C.jLap = 0; C.jIdx = 0;
  while (C.jIdx < C.junctions.length && C.junctions[C.jIdx].at <= C.s) C.jIdx++;
  C.nextAbs = C.jIdx < C.junctions.length ? C.junctions[C.jIdx].at : Infinity;
  C.pendingDir = 0; C.pendingAt = -1e9;
  const log = [];
  let pressed = false, frames = 0;
  while (C.s < ${TO} && frames < 60 * 400) {
    const j = C.junctions[C.jIdx];
    const dist = C.nextAbs - C.s;
    if (j && !pressed && dist > 0 && dist <= ${PRESS}) {
      const need = j.dir === 'L' ? -1 : 1;
      C.pendingDir = need; C.pendingAt = C.s;   // 等价于按对了方向键
      pressed = true;
      log.push({ act: 'press', at: Math.round(C.s), dir: j.dir, need, dist: +dist.toFixed(1) });
    }
    const before = C.jIdx;
    G.step(1 / 60);
    frames++;
    if (C.jIdx !== before) { log.push({ act: 'junction', at: Math.round(C.s), last: C.lastTurn, state: G.S.state }); pressed = false; }
    if (G.S.state !== 'playing') { log.push({ act: 'DEAD', cause: G.S.lastDeathCause, at: Math.round(C.s) }); break; }
  }
  return { log, endS: Math.round(C.s), state: G.S.state };
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
