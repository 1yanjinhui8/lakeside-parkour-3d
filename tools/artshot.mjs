// ============================================================================
//  artshot.mjs —— 美术验收截图（指定主题 / 里程 / 时段 / 画质）
//  用法：
//    node tools/artshot.mjs --theme=campus --arc=1300 --t=0.62 --out=shots/c1.png
//    node tools/artshot.mjs --theme=city --t=0.86 --out=shots/city-night.png
//  依赖：8765 上的 _srv.js + 9222 上的 CDP（Chrome/Edge --remote-debugging-port）
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    return kv ? kv.slice(f.length + 1) : d;
};
const PORT = 9222;
const THEME = val('--theme', 'campus');
const ARC = val('--arc', '');
const T = val('--t', '0.62');
const WX = val('--wx', 'clear');
const Q = val('--q', 'high');
const OUT = path.resolve(ROOT, val('--out', 'screenshots/art/_shot.png'));
const W = parseInt(val('--w', '1280'), 10);
const H = parseInt(val('--h', '720'), 10);
const WAIT = parseInt(val('--wait', '2600'), 10);
const LOCK = val('--lock', '1') !== '0';
const FILE = val('--file', '.perf-real.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(path.dirname(OUT), { recursive: true });

// 关掉除当前以外的页面，避免多个 3D 页面抢 GPU
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(350);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    if (m.method === 'Runtime.consoleAPICalled') {
        const line = m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (m.params.type === 'error') errs.push(line);
        if (process.env.ART_LOG) console.log('[console] ' + line.slice(0, 260));
    }
});
const send = (m, p = {}, tmo = 90000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 90000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = `http://127.0.0.1:8765/${FILE}?q=${Q}&t=${T}&wx=${WX}&theme=${THEME}&v=${Date.now()}`;
await send('Page.navigate', { url }, 120000);

let ready = false;
for (let i = 0; i < 240; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player')) { ready = true; break; }
    await sleep(300);
}
if (!ready) { console.error('游戏未就绪'); console.error(errs.slice(0, 5).join('\n')); process.exit(2); }

// 开局 → 目标主题
await ev(`(() => {
  const G = window.__game;
  G.setHomeTheme(${JSON.stringify(THEME)});
  G.startGame();
  return true;
})()`);
await sleep(600);
if (ARC !== '') {
    await ev(`(() => {
      const G = window.__game;
      if (G.CAMPUS && G.CAMPUS.ready) G.campusRewindTo(${Number(ARC)});
      return true;
    })()`);
}
// 站住别死：转场无敌拉满 + 关掉自适应降级，保证截图是同档位
// 关键：直接置 paused（不走 togglePause，否则会弹出暂停面板）。
// 暂停只停玩法逻辑，updateCamera 仍在跑，相机会收敛到静止的玩家身上，
// 于是截图里程就是 --arc 指定的那一段，不会被「跑了两秒」带偏。
await ev(`(() => {
  const G = window.__game;
  G.S.transGrace = 1e9;
  G.QUALITY.adaptive = false;
  G.S.flying = false;
  G.S.paused = true;
  return true;
})()`);
await sleep(WAIT);
const info = await ev(`(() => {
  const G = window.__game;
  const r = G.renderer.info;
  return JSON.stringify({ theme: G.Scene.id, arc: Math.round((G.CAMPUS && G.CAMPUS.s) || 0),
    calls: r.render.calls, tris: r.render.triangles,
    geo: r.memory.geometries, tex: r.memory.textures, fps: Math.round(1000 / (G.PERF && G.PERF.ms || 16.7)) });
})()`);
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(r.data, 'base64'));
console.log('OK', OUT, info);
if (errs.length) console.log('ERR:', errs.slice(0, 4).join(' | '));
ws.close();
process.exit(0);
