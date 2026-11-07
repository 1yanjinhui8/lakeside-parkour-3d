// ============================================================================
//  cybershot.mjs —— 城市街区连拍（昼夜 / 天气 / 画质档位）
//  用法：node tools/cybershot.mjs --t=0.68 --wx=clear --q=high --n=6 --gap=900
//  依赖：tools/start-cdp 起好的 9222 + _srv3.js（8766）
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    return kv ? kv.slice(f.length + 1) : d;
};
const T = val('--t', '0.68');
const WX = val('--wx', 'clear');
const Q = val('--q', 'high');
const N = parseInt(val('--n', '4'), 10);
const GAP = parseInt(val('--gap', '900'), 10);
const TAG = val('--tag', 'cyber');
const FILE = val('--file', '.perf-real.html');
const OUT = path.join(ROOT, 'screenshots');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=${Q}&theme=city&t=${T}&wx=${WX}&v=${stamp}` }, 90000);

for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive = false; true`);
await sleep(700);

fs.mkdirSync(OUT, { recursive: true });
const shots = [];
for (let i = 0; i < N; i++) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const fp = path.join(OUT, `${TAG}-${i}.png`);
    fs.writeFileSync(fp, Buffer.from(r.data, 'base64'));
    shots.push(path.basename(fp));
    await sleep(GAP);
}

const info = await ev(`JSON.stringify({ merge: window.__game.mergeState, dc: window.__game.renderer.info.render.calls,
    meshes: window.__game.renderer.info.render.triangles, dist: window.__game.S.dist|0 })`);
console.log(JSON.stringify({ shots, info: JSON.parse(info || '{}'), errors: errs.slice(0, 8) }, null, 1));
ws.close();
