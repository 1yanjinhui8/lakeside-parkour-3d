// 同一机位对比：默认阴影相机 vs 放大阴影相机（看岸边的阶梯带是不是视锥边界造成的）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'campus');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ARC = 1600;

for (const t of (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('shot', name);
};

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-real.html')).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:8766/.perf-real.html?autostart&q=high&theme=campus&v=${stamp}` });
for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.CAMPUS && window.__game.CAMPUS.ready').catch(() => 0)) break;
    await sleep(300);
}
await ev(`(() => { const G = window.__game; G.startGame(); G.QUALITY.adaptive = false; window.__noTurnFail = true; return true; })()`);
await sleep(1500);
await ev(`(() => { const G = window.__game; G.__wx && G.__wx.setTime && G.__wx.setTime(0.36); return true; })()`);
await sleep(500);

const goArc = async () => {
    await ev(`(() => { const G = window.__game; G.CAMPUS.s = ${ARC}; G.CAMPUS.jIdx = 0; G.S.transGrace = 99; return true; })()`);
    await sleep(600);
};

await goArc();
await shot('_cmp_default.png');

// 放大阴影相机
await ev(`(() => {
  const G = window.__game;
  G.scene.traverse(o => {
    if (!o.isDirectionalLight) return;
    const c = o.shadow.camera;
    Object.assign(c, { left: -90, right: 90, top: 110, bottom: -110, near: 1, far: 300 });
    c.updateProjectionMatrix();
    o.shadow.mapSize.set(2048, 2048);
    if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
  });
  G.renderer.shadowMap.needsUpdate = true;
  return true;
})()`);
await sleep(900);
await goArc();
await shot('_cmp_wide.png');

// 关阴影：确认锯齿是不是阴影造成的
await ev(`(() => { const G = window.__game; G.renderer.shadowMap.enabled = false; G.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; }); return true; })()`);
await sleep(600);
await goArc();
await shot('_cmp_noshadow.png');
console.log('s=', await ev('+window.__game.CAMPUS.s.toFixed(0)'));
process.exit(0);
