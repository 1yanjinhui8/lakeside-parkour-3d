// ============================================================================
//  cyberorbit.mjs —— 城市街区「设计审图」截图
//  做法：把 requestAnimationFrame 换掉让主循环停下，再手动摆相机 + 渲染，
//  这样能俯瞰整段街区，确认塔型/地标几何是否正确。
//  用法：node tools/cyberorbit.mjs --t=0.68 --at=40 --cam=0,26,34 --look=0,14,-30
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const T = val('--t', '0.68'), WX = val('--wx', 'clear'), Q = val('--q', 'high');
const AT = parseFloat(val('--at', '0'));
const CAMS = val('--cam', '0,26,40').split(';');
const LOOKS = val('--look', '0,12,-40').split(';');
const TAG = val('--tag', 'orbit');
const FILE = val('--file', '.perf-real.html');
const OUT = path.join(ROOT, 'screenshots');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
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
await ev(`window.__game.startGame(); window.__game.QUALITY.adaptive = false; true`);
await sleep(500);
if (AT > 0) {
    // 只靠 transGrace 无敌，不清 obstacles 数组（清数组会留下仍在渲染的孤儿 mesh）
    await ev(`(() => { const g = window.__game; let n = 0;
        // 加载 400+MB 地标模型后启动变慢，探针就绪时游戏可能还停在 menu，
        // step() 在 menu 下不推进里程 —— 先强制进 playing 再跑。
        if (g.S.state !== 'playing') g.S.state = 'playing';
        while (g.S.D < ${AT} && n++ < 40000) { g.S.transGrace = 1e9; g.step(1/60); }
        return Math.round(g.S.D); })()`);
}
// 停掉主循环：换掉 rAF，等当前这一帧跑完就不再排下一帧
await ev(`window.requestAnimationFrame = () => 0; true`);
await sleep(600);

fs.mkdirSync(OUT, { recursive: true });
const files = [];
for (let i = 0; i < CAMS.length; i++) {
    const c = CAMS[i].split(',').map(Number);
    const l = (LOOKS[i] || LOOKS[0]).split(',').map(Number);
    await ev(`(() => { const g = window.__game;
        g.camera.position.set(${c[0]}, ${c[1]}, ${c[2]});
        g.camera.lookAt(${l[0]}, ${l[1]}, ${l[2]});
        g.camera.fov = 62; g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fp = path.join(OUT, `${TAG}-${i}.png`);
    fs.writeFileSync(fp, Buffer.from(shot.data, 'base64'));
    files.push(path.basename(fp));
}
console.log(JSON.stringify({ files }, null, 1));
ws.close();
