// 湖畔轨道场景截图：确认「校园底板不再叠在轨道场景上」
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, HTTP = 8766;
const OUT = path.join(ROOT, 'screenshots', 'campus');
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-real.html')).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/.perf-real.html?autostart&q=high&theme=lakeside&v=${stamp}` });
for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => 0)) break;
    await sleep(300);
}
await ev(`(() => { const G = window.__game; G.startGame(); G.QUALITY.adaptive = false; window.__noTurnFail = true; window.__wx.setTime(0.36); return true; })()`);
await sleep(1200);

// 先看可见性：轨道场景里底板必须是隐藏的
console.log('状态:', await ev(`JSON.stringify({
  scene: document.getElementById('hudScene').textContent,
  plateVisible: window.__game.CAMPUS.group.visible,
  dc: window.__game.renderer.info.render.calls,
  tris: window.__game.renderer.info.render.triangles
})`));

for (const [i, wait] of [[1, 2000], [2, 2600], [3, 3000]]) {
    await sleep(wait);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, `lakeside_${i}.png`);
    if (r.result?.data) { fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('shot ->', f); }
}
console.log('结束状态:', await ev(`JSON.stringify({ scene: document.getElementById('hudScene').textContent, plateVisible: window.__game.CAMPUS.group.visible })`));
process.exit(0);
