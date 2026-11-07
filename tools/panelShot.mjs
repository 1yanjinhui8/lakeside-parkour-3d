// ============================================================================
//  panelShot.mjs —— 打开设置面板截图，确认「终点镜头」这一行渲染正常
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const OUT = path.join(ROOT, 'screenshots');

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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object"').catch(() => false)) break;
    await sleep(500);
}
await sleep(1200);
const info = await ev(`(()=>{
  const g = window.__game;
  document.getElementById('volBtn').click();
  const row = document.getElementById('fvRow');
  return JSON.stringify({
    rowExists: !!row,
    btns: row ? [...row.querySelectorAll('.qBtn')].map(b => b.textContent + (b.classList.contains('on') ? '(on)' : '')) : [],
    tip: (document.getElementById('fvTip') || {}).textContent,
    mode: g.FINISH_VIEW.mode,
    opts: [g.finishCam.options.orbitDistance, g.finishCam.options.orbitPitchDeg, g.finishCam.options.fov]
  });
})()`);
console.log('面板:', info);
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'panel-finishview.png'), Buffer.from(shot.data, 'base64'));
console.log('已截图 screenshots/panel-finishview.png');
ws.close();
