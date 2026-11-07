// ============================================================================
//  fanfareprobe.mjs —— 验证终点 360° 环绕过场
//  检查：① 到点是否触发 ② 相机是否真的在绕 ③ 雾/远平面是否拉开 ④ 结束后是否恢复
//  用法：node tools/fanfareprobe.mjs [--file=.perf-real.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push(desc.slice(0, 400));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&t=0.68&wx=clear&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(800);

const snap = async () => JSON.parse(await ev(`(()=>{
  const g = window.__game, c = g.camera;
  return JSON.stringify({
    D: Math.round(g.S.D), segEnd: Math.round(g.Scene.segEnd), state: g.S.state,
    phase: g.finishCam.phase, prog: +g.finishCam.progress.toFixed(3),
    cam: [+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)],
    fov: +c.fov.toFixed(1), far: +c.far.toFixed(0),
    fogFar: g.scene.fog ? +g.scene.fog.far.toFixed(0) : -1,
    active: g.FINISH.active, portalPhase: g.Scene.phase
  });
})()`) || '{}');

// 推进到触发点（segEnd − 34 = 2966）
await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<2966&&n++<400000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
await sleep(200);
console.log('触发瞬间:', JSON.stringify(await snap()));

// 让主循环跑，采样环绕过程
const samples = [];
for (let i = 0; i < 7; i++) {
    await sleep(1800);
    samples.push(await snap());
}
console.log('环绕采样:');
for (const r of samples) {
    const az = (Math.atan2(r.cam[0], r.cam[2]) * 180 / Math.PI).toFixed(0);
    console.log(`  phase=${String(r.phase).padEnd(6)} prog=${String(r.prog).padEnd(5)} cam=(${r.cam.join(',')}) 方位角≈${az}° fov=${r.fov} far=${r.far} fogFar=${r.fogFar} state=${r.state}`);
}

// 等它自己走完
for (let i = 0; i < 20; i++) {
    const r = await snap();
    if (r.phase === 'idle' && r.state !== 'fanfare') break;
    await sleep(1000);
}
await sleep(600);
const after = await snap();
console.log('结束后:', JSON.stringify(after));
console.log('异常:', JSON.stringify(caught.slice(0, 4)));
ws.close();
