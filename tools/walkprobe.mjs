// ============================================================================
//  walkprobe.mjs —— 校园实跑探针：定点截图 + 传送门包围盒 + 横向移动对照
//  用法： node tools/walkprobe.mjs [arcs=780,1590,2697] [out=screenshots/bugs]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const OUT = val('--out', 'screenshots/bugs');
const ARCS = val('--arcs', '780,1590,2697').split(',').map(Number);
const THEME = val('--theme', 'campus');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
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
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const s2 = m.params.args.map(a => a.description || a.value).join(' ');
        if (!/chrome-extension:/.test(s2)) caught.push('ERR: ' + s2.slice(0, 300));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => { });
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=${THEME}&v=${stamp}` }, 120000);
let ok = false;
for (let i = 0; i < 240; i++) {
    ok = await ev('typeof window.__game==="object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => false);
    if (ok) break;
    await sleep(300);
}
if (!ok) { console.log('页面没起来', caught); process.exit(1); }

await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; window.__noTurnFail=true; true');
await sleep(1500);
await ev('(window.__wx && window.__wx.setTime) ? (window.__wx.setTime(0.36), true) : false');
await sleep(500);

const base = await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  return { ready: C.ready, total: +C.total.toFixed(1), startArc: C.startArc,
           junctions: C.junctions.map(j => [Math.round(j.at), j.dir]),
           dc: G.renderer.info.render.calls, tris: G.renderer.info.render.triangles };
})()`);
console.log('CAMPUS', JSON.stringify(base));

const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(ROOT, OUT, name + '.png');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
    return path.relative(ROOT, f);
};

// ---- 定点：把里程放在弯道/窄点，镜头保持游戏内视角 ----
for (const arc of ARCS) {
    await ev(`(() => {
      const G = window.__game, C = G.CAMPUS;
      C.s = ${arc};
      C.jIdx = 0; C.jLap = 0;
      while (C.jIdx < C.junctions.length && C.junctions[C.jIdx].at <= C.s) C.jIdx++;
      C.nextAbs = C.jIdx < C.junctions.length ? C.junctions[C.jIdx].at : Infinity;
      C.pendingDir = 0;
      return true;
    })()`);
    await sleep(400);
    console.log('shot', await shot('arc' + arc));
}

// ---- 传送门：跑到校园段尾声，看校门落在哪、底边多高 ----
const gate = await ev(`(async () => {
  const G = window.__game;
  // 冻住里程：门生成后停在原地，方便量位置（否则 30m 一过就换场了）
  G.CONFIG.speed.start = 0; G.CONFIG.speed.max = 0; G.CONFIG.speed.factor = 1;
  G.S.state = 'playing'; G.Scene.phase = 'run';
  G.Scene.segEnd = G.S.D + 30;
  G.Scene.next = 'lakeside';
  const t0 = performance.now();
  while (!G.PortalFX.group && performance.now() - t0 < 4000) { await new Promise(r => setTimeout(r, 60)); }
  const g = G.PortalFX.group;
  if (!g) return { ok: false, kind: G.PortalFX.kind };
  g.updateWorldMatrix(true, true);
  const box = new (g.position.constructor.prototype.constructor === Object ? Object : Object)();
  // 用世界矩阵手动求包围盒，避免依赖 THREE.Box3
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  g.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.count; i += 7) {
      const v = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
      const w = o.localToWorld(new (o.position.constructor)(v.x, v.y, v.z));
      mn = [Math.min(mn[0], w.x), Math.min(mn[1], w.y), Math.min(mn[2], w.z)];
      mx = [Math.max(mx[0], w.x), Math.max(mx[1], w.y), Math.max(mx[2], w.z)];
    }
  });
  return {
    ok: true, kind: G.PortalFX.kind, z: +g.position.z.toFixed(1), x: +g.position.x.toFixed(1),
    minY: +mn[1].toFixed(2), maxY: +mx[1].toFixed(2),
    minX: +mn[0].toFixed(1), maxX: +mx[0].toFixed(1),
    minZ: +mn[2].toFixed(1), maxZ: +mx[2].toFixed(1),
    campos: [G.camera.position.x, G.camera.position.y, G.camera.position.z].map(v => +v.toFixed(1)),
  };
})()`);
console.log('GATE', JSON.stringify(gate));
console.log('shot', await shot('gate'));

// 近景：把门拉到 22m 处，检查门洞黑芯和底座是否贴地
await ev(`(() => {
  const G = window.__game, g = G.PortalFX.group;
  if (!g) return false;
  g.userData.tz = -22;
  G.step(0.001);
  return true;
})()`);
await sleep(400);
console.log('shot', await shot('gate-close'));

// ---- 横向移动对照：车（障碍）世界坐标是否随变道漂移 ----
const lane = await ev(`(async () => {
  const G = window.__game, C = G.CAMPUS;
  G.Scene.segEnd = 999999; G.Scene.next = 'lakeside';
  C.s = 900;
  // 放一辆校车在正前方 30m
  G.addObstacle({ type: 'schoolbus', lane: 1 });
  const o = G.obstacles[G.obstacles.length - 1];
  o.z = -30; o.mesh.position.z = -30;
  await new Promise(r => setTimeout(r, 500));
  const before = { ox: o.mesh.position.x, oz: o.mesh.position.z, px: G.S.x, pxCam: G.camera.position.x };
  G.S.lane = 2;
  for (let i = 0; i < 40; i++) { G.step(0.016); await new Promise(r => requestAnimationFrame(r)); }
  const after = { ox: o.mesh.position.x, oz: o.mesh.position.z, px: G.S.x, pxCam: G.camera.position.x };
  return { before, after, laneX: o.x, type: o.type };
})()`);
console.log('LANE', JSON.stringify(lane));

console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
