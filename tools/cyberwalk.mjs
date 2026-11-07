// ============================================================================
//  cyberwalk.mjs —— 城市街区「可控里程」截图
//  用 __game.step() 手动推进逻辑（不渲染），把玩家送到指定里程再截图，
//  这样能精确停在某座地标前面。每步清空障碍，避免半路撞死。
//  用法：node tools/cyberwalk.mjs --t=0.68 --wx=clear --q=high --stops=60,120,200 --tag=lm
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const T = val('--t', '0.68'), WX = val('--wx', 'clear'), Q = val('--q', 'high');
const STOPS = val('--stops', '40,80,120').split(',').map(Number);
const TAG = val('--tag', 'walk');
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
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
});
const send = (m, p = {}, tmo = 90000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 90000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=${Q}&theme=city&t=${T}&wx=${WX}&v=${stamp}` }, 120000);
for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__game.S.paused = false; true`);
await sleep(600);

fs.mkdirSync(OUT, { recursive: true });
const out = [];
let prev = 0;
for (const stop of STOPS) {
    // 手动推进到目标里程。只靠 transGrace 保持无敌——不要清 obstacles 数组：
    // `obstacles.length = 0` 只是丢引用，孤儿 mesh 还留在 scene 里继续渲染，
    // 截图会带上残留障碍、drawcall 也会虚高。
    const r = await ev(`(() => {
        const g = window.__game;
        let guard = 0;
        while (g.S.D < ${stop} && guard++ < 40000) {
            if (g.S.state !== 'playing') g.S.state = 'playing';   // 同上：GLB 加载后可能停在 menu
            g.S.transGrace = 1e9;
            g.step(1 / 60);
        }
        return Math.round(g.S.D);
    })()`);
    await sleep(420);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fp = path.join(OUT, `${TAG}-${stop}m.png`);
    fs.writeFileSync(fp, Buffer.from(shot.data, 'base64'));
    out.push({ at: r, file: path.basename(fp) });
    prev = stop;
}
const info = await ev(`JSON.stringify({ dc: window.__game.renderer.info.render.calls, state: window.__game.S.state })`);
console.log(JSON.stringify({ out, info: JSON.parse(info || '{}'), errors: errs.slice(0, 5) }, null, 1));
ws.close();
