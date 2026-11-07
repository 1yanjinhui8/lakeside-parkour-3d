// 医学部（campus2）场景验收：底板状态 + 沿环多机位截图
// 用法： node tools/campus2shot.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = 'screenshots/campus';
const FILE = '.perf-real.html';
const PORT_HTTP = 8766;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = list.find(t => t.type === 'page' && t.url.includes('127.0.0.1:' + PORT_HTTP));
if (!page) {
    for (const t of list.filter(x => x.type === 'page')) await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => { });
    page = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 45000) => {
    const id = ++seq;
    const pr = new Promise(a => pend.set(id, a));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 45000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.result?.value;
const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r.result?.data) { console.log('shot fail', name); return; }
    fs.writeFileSync(path.join(ROOT, OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('  → ' + name);
};

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=campus2&t=0.33&v=${stamp}` }, 90000);
let up = false;
for (let i = 0; i < 200; i++) {
    up = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS_SETS && !!window.__game.player').catch(() => false);
    if (up) break;
    await sleep(300);
}
if (!up) { console.log('页面没起来'); process.exit(1); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = true; true');
await sleep(1400);

const st = await ev(`JSON.stringify({
  scene: window.__game.Scene.id,
  id: window.__game.CAMPUS.id,
  total: Math.round(window.__game.CAMPUS.total),
  s: Math.round(window.__game.CAMPUS.s),
  vis: window.__game.CAMPUS.group && window.__game.CAMPUS.group.visible,
  junc: window.__game.CAMPUS.junctions.map(j => j.at + ':' + j.dir + j.deg.toFixed(0)),
  dc: window.__game.renderer.info.render.calls,
  tris: window.__game.renderer.info.render.triangles
})`);
console.log('医学部状态:', st);

// 沿环采样（0 = 西南角起步 → 东行 → 北上 → 西行回）
for (const arc of [60, 500, 962, 1440, 1860]) {
    await ev(`(() => { const C = window.__game.CAMPUS; C.s = ${arc}; C.pendingDir = 0; C.pendingAt = -1e9;
      let idx = 0; while (idx < C.junctions.length && C.junctions[idx].at <= ${arc}) idx++;
      C.jIdx = idx; C.jLap = 0; C.nextAbs = idx < C.junctions.length ? C.junctions[idx].at : Infinity;
      return true; })()`);
    await sleep(650);
    await shot(`_bmu_arc${String(arc).padStart(4, '0')}.png`);
}

console.log('控制台:', logs.slice(-4).join(' | '));
process.exit(0);
