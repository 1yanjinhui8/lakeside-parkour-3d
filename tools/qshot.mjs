// ============================================================================
//  qshot.mjs —— 按画质档位各截一张图（确认低档没有把画面搞坏）
//  用法： node tools/qshot.mjs [--file=.perf-real.html] [--theme=city] [--q=low,mid,high]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    if (kv) return kv.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const FILE = val('--file', '.perf-real.html');
const THEME = val('--theme', 'city');
const QS = val('--q', 'low,mid,high').split(',');
const OUT = val('--out', 'screenshots');
const PORT_HTTP = val('--port', '8766');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(500);

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 30000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 30000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=${QS[0]}&theme=${THEME}&v=${stamp}` }, 60000);

for (let i = 0; i < 120; i++) {
    if ((await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false))) break;
    await sleep(300);
}
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive = false; true`);
await sleep(800);

fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
for (const q of QS) {
    await ev(`window.__game.setQuality(${JSON.stringify(q)}); window.__game.QUALITY.adaptive = false; true`);
    await sleep(1200);
    // 跑到有障碍物/装饰的段落再截图
    await ev(`window.__game.S.D = Math.max(window.__game.S.D, 120); true`).catch(() => { });
    await sleep(1500);
    await send('Page.bringToFront').catch(() => { });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, OUT, `quality-${q}-${THEME}.png`);
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    const st = await ev(`JSON.stringify({tier:window.__game.QUALITY.tier, shadow:window.__game.renderer.shadowMap.enabled, dpr:+window.__game.renderer.getPixelRatio().toFixed(2), blob: !!(window.__game.BlobShadow.mesh && window.__game.BlobShadow.mesh.visible), dist: Math.round(window.__game.S.D)})`);
    console.log(q, p, st);
}
await fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`).catch(() => { });
process.exit(0);
