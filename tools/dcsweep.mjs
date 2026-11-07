// ============================================================================
//  dcsweep.mjs —— 沿街扫一遍 drawcall / 三角面，找峰值
//  用法：node tools/dcsweep.mjs [--stops=7,40,80,120,160,200,240,280,320]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const STOPS = val('--stops', '7,40,80,120,160,200,240,280,320').split(',').map(Number);

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 90000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 90000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&t=0.68&wx=clear&v=${stamp}` }, 120000);
for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive=false; window.__game.S.paused=false; true`);
await sleep(1500);

const rows = [];
for (const d of STOPS) {
    // 推进到里程。只靠 transGrace 保持无敌，绝不清 obstacles 数组——
    // `obstacles.length = 0` 只是丢引用，孤儿 mesh 仍留在 scene 里继续渲染，
    // drawcall / geometries 会随里程单调虚高（这个坑踩过一次，别再踩）。
    await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<${d}&&n++<400000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
    await sleep(400);
    const r = await ev(`JSON.stringify({
        D: Math.round(window.__game.S.D),
        dc: window.__game.renderer.info.render.calls,
        tris: window.__game.renderer.info.render.triangles,
        geo: window.__game.renderer.info.memory.geometries
    })`);
    rows.push(JSON.parse(r));
}
console.log(JSON.stringify(rows, null, 0).replace(/},/g, '},\n'));
const dcs = rows.map(r => r.dc);
console.log('drawcall 区间:', Math.min(...dcs), '~', Math.max(...dcs));
console.log('三角面峰值:', Math.max(...rows.map(r => r.tris)));
ws.close();
