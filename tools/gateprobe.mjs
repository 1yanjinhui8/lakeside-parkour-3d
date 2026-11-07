// 验证川大门传送门：campus 段尾声出现校门洞口，穿门走转场
// 用法： node tools/gateprobe.mjs [--file=.perf-real.html]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = 'screenshots/campus';
const FILE = (process.argv.find(a => a.startsWith('--file=')) || '--file=.perf-real.html').split('=')[1];
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
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=campus&t=0.33&v=${stamp}` }, 90000);
let up = false;
for (let i = 0; i < 200; i++) {
    up = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS && !!window.__game.player').catch(() => false);
    if (up) break;
    await sleep(300);
}
if (!up) { console.log('页面没起来'); process.exit(1); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = true; true');
await sleep(1200);

// 把段落终点拉近，触发洞口 preview（提前 108m 摆门）
await ev(`(() => { const G = window.__game; G.Scene.segEnd = G.S.D + 150; G.S.nextRowS = 1e9; return true; })()`);
await sleep(1400);
const gateInfo = await ev(`JSON.stringify({
  kind: window.__game.PortalFX.kind,
  armed: window.__game.PortalFX.armed,
  hasGroup: !!window.__game.PortalFX.group,
  kids: window.__game.PortalFX.group ? window.__game.PortalFX.group.children.map(o => o.type + (o.isMesh ? '/' + (o.geometry || {}).type : '')).slice(0, 6) : null,
  gateMats: (() => { const out = []; window.__game.PortalFX.group && window.__game.PortalFX.group.traverse(o => { if (o.isMesh) out.push(o.material.name || o.material.type); }); return out.slice(0, 8); })(),
  dc: window.__game.renderer.info.render.calls,
  tris: window.__game.renderer.info.render.triangles
})`);
console.log('洞口:', gateInfo);
await shot('_gate_far.png');

// 把门拉到眼前 22m 处看细节
await ev(`(() => { const G = window.__game; G.S.D = G.Scene.segEnd - 25; return true; })()`);
await sleep(900);
await shot('_gate_close.png');

// 走进转场：推进到 segEnd 触发 portalIn，抓黑芯糊画面
await ev(`(() => { const G = window.__game; G.S.D = G.Scene.segEnd - 4; return true; })()`);
await sleep(700);
await shot('_gate_transit.png');
console.log('过场相位:', await ev('window.__game.Scene.phase'));

console.log('控制台:', logs.slice(-6).join(' | '));
process.exit(0);
