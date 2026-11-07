// ============================================================================
//  fanfareaim.mjs —— 诊断：环绕时相机到底对着谁，角色在不在画面里
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
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
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
await sleep(700);
await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<2966&&n++<400000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
await sleep(1500);

const info = JSON.parse(await ev(`(()=>{
  const g = window.__game, THREE_ = g.scene.constructor; // 只为了不 import
  const p = g.player.root;
  const wp = { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2) };
  const c = g.camera.position;
  // 角色在屏幕上的投影位置
  const v = p.position.clone(); v.y += 1.0;
  v.project(g.camera);
  const sx = Math.round((v.x * 0.5 + 0.5) * 1280), sy = Math.round((-v.y * 0.5 + 0.5) * 720);
  return JSON.stringify({
    playerWorld: wp, playerVisible: p.visible,
    cam: { x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1) },
    dist: +c.distanceTo(p.position).toFixed(2),
    screen: [sx, sy, +v.z.toFixed(3)],
    phase: g.finishCam.phase, prog: +g.finishCam.progress.toFixed(2),
    // 地标 z 位置
    landmarks: g.scenery.filter(o => o.userData && o.userData.noMerge).length
  });
})()`) || '{}');
console.log('环绕中:', JSON.stringify(info, null, 1));
ws.close();
