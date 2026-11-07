// 验证「双击 playable.html」（file://）时校园底板能不能起来
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        caught.push('EXC: ' + (d.exception?.description || d.text || '').slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        caught.push(m.params.type + ': ' + m.params.args.map(a => a.description || a.value).join(' ').slice(0, 300));
    }
});
const send = (m, p = {}, tmo = 90000) => { const id = ++seq; const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result)))); ws.send(JSON.stringify({ id, method: m, params: p })); return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async (e, tmo = 90000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const FILE = (process.argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || 'playable.html';
const url = 'file:///' + path.join(ROOT, FILE).replace(/\\/g, '/') + '?theme=campus&autostart';
console.log('打开:', url);
const t0 = Date.now();
await send('Page.navigate', { url }, 120000);

let ok = false;
for (let i = 0; i < 300; i++) {   // 最多等 90s（要联网拉 CDN 的 three）
    ok = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS').catch(() => false);
    if (ok) break;
    await sleep(300);
}
if (!ok) { console.log('❌ 页面 90s 内没起来'); console.log(caught.slice(0, 6)); process.exit(1); }
console.log('页面就绪，用时 %ds', Math.round((Date.now() - t0) / 1000));

let ready = false;
for (let i = 0; i < 200; i++) {
    ready = await ev('!!(window.__game.CAMPUS && window.__game.CAMPUS.ready)').catch(() => false);
    if (ready) break;
    await sleep(300);
}
const info = await ev(`JSON.stringify({
  ready: window.__game.CAMPUS.ready,
  plateUrl: window.__game.CAMPUS.ready ? 'ok' : '-',
  kids: window.__game.CAMPUS.group ? window.__game.CAMPUS.group.children.length : 0,
  tris: window.__game.renderer.info.render.triangles,
  dc: window.__game.renderer.info.render.calls,
  theme: window.__game.Scene.id,
  plateVisible: window.__game.CAMPUS.group ? window.__game.CAMPUS.group.visible : null
})`);
console.log('底板状态:', info);
console.log('耗时 %ds', Math.round((Date.now() - t0) / 1000));
fs.writeFileSync(path.join(ROOT, 'screenshots/campus/_file_protocol.png'),
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
console.log('控制台告警:', caught.length ? caught.slice(0, 5) : 'none');
process.exit(ready ? 0 : 1);
