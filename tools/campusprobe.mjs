// ============================================================================
//  campusprobe.mjs —— 真实校园底板验收：状态数字 + 沿路线多机位截图
//  用法： node tools/campusprobe.mjs [--arcs=0,400,800] [--file=.perf-real.html]
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
const FILE = val('--file', '.perf-real.html');
const OUT = val('--out', 'screenshots/campus');
const ARCS = val('--arcs', '0,300,600,900,1200,1500,1800,2100,2400,2700').split(',').map(Number);

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 500));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const s2 = m.params.args.map(a => a.description || a.value).join(' ');
        if (!/chrome-extension:/.test(s2)) caught.push('ERR: ' + s2.slice(0, 500));
    }
});
const send = (m, p = {}, tmo = 40000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 40000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
const url = `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=campus&v=${stamp}`;
await send('Page.navigate', { url }, 90000);

let ok = false;
for (let i = 0; i < 200; i++) {
    ok = await ev('typeof window.__game === "object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => false);
    if (ok) break;
    await sleep(300);
}
if (!ok) { console.log('页面没起来'); process.exit(1); }

await ev('window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = true; true');
await sleep(1200);
// 强制午后光照：否则碰上黎明/黄昏，画面全是橘色，看不出材质对不对
await ev('(window.__wx && window.__wx.setTime) ? (window.__wx.setTime(0.36), true) : false');
await sleep(600);

const info = await ev(`(() => {
  const C = window.__game.CAMPUS, G = window.__game;
  const r = G.renderer.info.render;
  return {
    ready: C.ready, plate: !!C.group, visible: C.group ? C.group.visible : null,
    total: +C.total.toFixed(1), pts: C.pts.length, junctions: C.junctions.length,
    junctionList: C.junctions.map(j => [Math.round(j.at), j.dir, Math.round(j.deg)]),
    s: +C.s.toFixed(1), theta: +(C.theta * 180 / Math.PI).toFixed(1),
    dc: r.calls, tris: r.triangles,
    sceneChildren: G.scene.children.length,
    worldMeshes: (() => { let n = 0; G.worldGroup.traverse(o => { if (o.isMesh) n++; }); return n; })(),
    plateTris: (() => { let n = 0; if (C.group) C.group.traverse(o => { if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); })(),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
for (const arc of ARCS) {
    await ev(`window.__game.CAMPUS.s = ${arc}; window.__game.CAMPUS.jIdx = 0; window.__game.CAMPUS.jLap = Math.floor(${arc} / window.__game.CAMPUS.total); true`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(ROOT, OUT, `arc${String(Math.round(arc)).padStart(4, '0')}.png`);
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('shot arc=' + arc + ' -> ' + path.relative(ROOT, f));
}

// 俯视图：把相机吊到 260m 高，直接看校园布局对不对
await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  C.s = 1200; C.jIdx = 0; C.jLap = 0;
  window.__freezeCam = true;
  return true;
})()`);
await sleep(400);
await ev(`(() => {
  const G = window.__game, cam = G.camera;
  G.scene.fog.near = 9000; G.scene.fog.far = 16000;   // 临时关雾，看清布局
  cam.fov = 55; cam.far = 4000;
  // 底板是在动的：要用底板的局部坐标换算到世界，不能直接写世界坐标。
  // 另外别正对下方看：视线与 up 平行时 lookAt 会退化成 NaN，整屏变纯色。
  const C2 = G.CAMPUS, tmp = C2.group.position.clone(), aim = C2.group.position.clone();
  tmp.set(-430, 300, -60);   C2.group.localToWorld(tmp);
  aim.set(-430, 0, -470);    C2.group.localToWorld(aim);
  cam.position.copy(tmp); cam.lookAt(aim);
  cam.updateProjectionMatrix();
  return true;
})()`);
await sleep(400);
{
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(ROOT, OUT, 'overhead.png');
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('shot overhead -> ' + path.relative(ROOT, f));
}

console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
