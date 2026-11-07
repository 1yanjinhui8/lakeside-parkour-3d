// 逐材质消隐 + 像素差分：定位「岸边锯齿」到底属于哪个材质
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
await sleep(1500);
await ev(`(() => { const G = window.__game; G.__wx && G.__wx.setTime && G.__wx.setTime(0.36); return true; })()`);
await sleep(300);
await ev(`(() => { const G = window.__game; G.CAMPUS.s = 1600; G.CAMPUS.jIdx = 0; G.S.transGrace = 99; return true; })()`);
await sleep(500);
await ev(`(() => { window.__game.CAMPUS.ready = false; return true; })()`);   // 冻结底板
await sleep(300);

// 用 CDP 截图，再在页面里用 canvas 比对不现实 —— 直接在 Node 里做二进制差分不可行（PNG 压缩），
// 所以改用「页面内离屏渲染统计」：把每个材质的 visible 关掉，统计 cropped 区域的采样颜色。
// 更简单可靠的方式：逐材质关掉后截图，交给 Python 对比。
const mats = JSON.parse(await ev(`JSON.stringify((() => {
  const out = [];
  window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material) out.push(String(o.material.name || '')); });
  return [...new Set(out)];
})())`));
console.log('材质:', mats.join(','));

const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
};
await shot('_diff_base.png');
for (const nm of mats) {
    await ev(`(() => { window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.material) o.visible = (String(o.material.name) !== ${JSON.stringify(nm)}); }); return true; })()`);
    await sleep(260);
    await shot(`_diff_${nm || 'none'}.png`);
}
console.log('done');
process.exit(0);
