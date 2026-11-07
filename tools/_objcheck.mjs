// 校验 OBJ+MTL+贴图能不能真的显示出来（截图 + 统计）
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://127.0.0.1:8766/tmp/objtest/_preview.html';
const OUT = process.argv[3] || 'tmp/objtest/_shot.png';

for (const t of (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
await send('Page.navigate', { url: URL });
for (let i = 0; i < 160; i++) {
    if (await ev('!!window.__ready').catch(() => 0)) break;
    await sleep(500);
}
console.log('ready:', await ev('!!window.__ready'));
console.log('stats:', await ev('JSON.stringify(window.__stats || null)'));
console.log('hud  :', await ev("document.getElementById('hud').textContent"));
await sleep(2500);
console.log('节点:', await ev(`JSON.stringify((() => {
  const out = [];
  const root = window.__obj;
  if (!root) return 'no __obj';
  root.children.forEach((o, i) => {
    if (!o.isMesh) return out.push([i, o.type, o.name]);
    const m = o.material;
    out.push([i, o.name, m && m.name, !!(m && m.map), !!(m && m.map && m.map.image),
              o.geometry.attributes.position.count]);
  });
  return out;
})())`));
const r = await send('Page.captureScreenshot', { format: 'png' });
if (r.result?.data) { fs.writeFileSync(OUT, Buffer.from(r.result.data, 'base64')); console.log('shot ->', OUT); }
process.exit(0);
