// 冻结底板后逐层隔离：定位岸边「阶梯」到底属于哪一层
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'campus');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
await sleep(400);
// 摆到湖滨，然后冻结底板（ready=false 会让 campusUpdate 直接返回）
await ev(`(() => { const G = window.__game; G.CAMPUS.s = 1600; G.CAMPUS.jIdx = 0; G.S.transGrace = 99; return true; })()`);
await sleep(500);
await ev(`(() => { window.__game.CAMPUS.ready = false; return true; })()`);
await sleep(300);
console.log('冻结:', await ev(`JSON.stringify({ ready: window.__game.CAMPUS.ready, s: +window.__game.CAMPUS.s.toFixed(0) })`));

const hide = async names => ev(`(() => {
  const keep = ${JSON.stringify(names)};
  window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material) o.visible = !keep.includes(String(o.material.name || '')); });
  return true;
})()`);
const showAll = async () => ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh) o.visible = true; }); return true; })()`);

await shot('_fz_all.png');
await ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'tree') o.visible = false; }); return true; })()`);
await sleep(400); await shot('_fz_notree.png');
await ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'tree') o.visible = true; }); return true; })()`);
// 关掉水面的 polygonOffset：掠射角下 factor 会把水面推得比草地还前
await ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'water') { o.material.polygonOffset = false; o.material.needsUpdate = true; } }); return true; })()`);
await sleep(400); await shot('_fz_nooffset.png');
await hide(['green']); await sleep(250); await shot('_fz_nogreen.png');
await hide(['water']); await sleep(250); await shot('_fz_nowater.png');
await hide(['ground']); await sleep(250); await shot('_fz_noground.png');
await hide(['street']); await sleep(250); await shot('_fz_nostreet.png');
// 只留水面：看它的真实轮廓
await ev(`(() => { const C = window.__game.CAMPUS; C.group.traverse(o => { if (o.isMesh && o.material) o.visible = (String(o.material.name) === 'water'); }); return true; })()`);
await sleep(300); await shot('_fz_wateronly.png');
await showAll();
// 整个底板关掉：如果岸边/湖还在，说明那是别的场景的几何
await ev(`(() => { window.__game.CAMPUS.group.visible = false; return true; })()`);
await sleep(400); await shot('_fz_noplate.png');
await ev(`(() => { window.__game.CAMPUS.group.visible = true; return true; })()`);
process.exit(0);
