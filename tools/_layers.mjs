// 分层隔离：在湖岸把 water / green / ground 逐个隐藏，看锯齿属于哪一层
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
await sleep(1500);                       // 等 resetScene 跑完，再设里程，否则会被复位成 0
await ev(`(() => { const G = window.__game; G.CAMPUS.s = 1600; G.CAMPUS.jIdx = 0; return true; })()`);
await sleep(700);
console.log('状态:', await ev(`JSON.stringify({ s: +window.__game.CAMPUS.s.toFixed(0), plateVisible: window.__game.CAMPUS.group.visible })`));

const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('shot', name);
};

const only = async (names, invert) => ev(`(() => {
  const C = window.__game.CAMPUS;
  const keep = ${JSON.stringify(names)};
  C.group.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const n = String(o.material.name || '');
    o.visible = ${invert ? 'keep.includes(n)' : '!keep.includes(n)'};
  });
  return true;
})()`);

await shot('_iso_all.png');
// 试 normalBias：平面上的阴影 acne 主要靠它治
await ev(`(() => { const G=window.__game; G.scene.traverse(o=>{ if(o.isDirectionalLight){ o.shadow.normalBias=0.08; o.shadow.bias=-0.0004; o.shadow.map && (o.shadow.map.dispose(), o.shadow.map=null); } }); G.renderer.shadowMap.needsUpdate=true; return true; })()`);
await sleep(600); await shot('_iso_bias.png');
await ev(`(() => { const G=window.__game; G.scene.traverse(o=>{ if(o.isDirectionalLight){ o.shadow.mapSize.set(2048,2048); o.shadow.map && (o.shadow.map.dispose(), o.shadow.map=null); } }); G.renderer.shadowMap.needsUpdate=true; return true; })()`);
await sleep(700); await shot('_iso_bias2k.png');
// 放大阴影相机：低太阳角下阴影会被小视锥切出边界，形成沿岸的阶梯带
await ev(`(() => { const G=window.__game; G.scene.traverse(o=>{ if(o.isDirectionalLight){ const c=o.shadow.camera; Object.assign(c,{left:-90,right:90,top:110,bottom:-110,near:1,far:300}); c.updateProjectionMatrix(); o.shadow.map && (o.shadow.map.dispose(), o.shadow.map=null); } }); G.renderer.shadowMap.needsUpdate=true; return true; })()`);
await sleep(800); await shot('_iso_widecam.png');
// 关阴影再看一次：锯齿是不是阴影贴图的锯齿
await ev(`(() => { const G = window.__game; G.renderer.shadowMap.enabled = false; G.scene.traverse(o => { if (o.isMesh) o.material && (o.material.needsUpdate = true); }); return true; })()`);
await sleep(400); await shot('_iso_noshadow.png');
await ev(`(() => { const G = window.__game; G.renderer.shadowMap.enabled = true; G.scene.traverse(o => { if (o.isMesh) o.material && (o.material.needsUpdate = true); }); return true; })()`);
await sleep(400);
await only(['water'], true);
await sleep(300); await shot('_iso_water.png');
await only(['green'], true);
await sleep(300); await shot('_iso_green.png');
await only(['ground'], true);
await sleep(300); await shot('_iso_ground.png');
await ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh) o.visible = true; }); return true; })()`);
process.exit(0);
