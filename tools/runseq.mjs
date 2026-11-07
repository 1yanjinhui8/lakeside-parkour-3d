// ============================================================================
//  runseq.mjs —— 真跑一段，按固定间隔截 8 帧，拼图用
//  用法： node tools/runseq.mjs [--lane=1] [--n=8] [--gap=900]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const LANE = +(val('--lane', '1'));
const N = +(val('--n', '8'));
const GAP = +(val('--gap', '900'));
const OUT = val('--out', 'screenshots/runseq');
const TAG = val('--tag', 'run');

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
const ev = async (e, tmo = 60000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=mid&theme=campus&v=${Date.now()}` }, 120000);
for (let i = 0; i < 240; i++) {
    if (await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break;
    await sleep(300);
}
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive=false; window.__noTurnFail=true;
  (window.__wx&&window.__wx.setTime)?window.__wx.setTime(0.36):0; true`);
await sleep(1500);

fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
const log = [];
for (let i = 0; i < N; i++) {
    await ev(`(()=>{ const G=window.__game; G.S.lane=${(LANE + (i % 3) - 1 + 3) % 3}; G.S.transGrace=99; return 1; })()`);
    await sleep(GAP);
    await ev('window.__game.S.transGrace = 99; window.__noTurnFail = true; true');
    const info = await ev(`(() => {
      const G = window.__game, C = G.CAMPUS;
      const obs = G.obstacles.slice(0, 6).map(o => ({ t: o.type, x: +o.x.toFixed(1), z: +o.z.toFixed(1), wx: +o.mesh.position.x.toFixed(1), wz: +o.mesh.position.z.toFixed(1) }));
      return { D: +G.S.D.toFixed(1), s: +C.s.toFixed(1), theta: +(C.theta*180/Math.PI).toFixed(1), cam: [+G.camera.position.x.toFixed(1), +G.camera.position.z.toFixed(1)], obs };
    })()`);
    log.push(info);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, OUT, `${TAG}-${i}.png`), Buffer.from(s.data, 'base64'));
}
console.log(JSON.stringify(log, null, 1));
console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
