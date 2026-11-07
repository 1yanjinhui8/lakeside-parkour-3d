// ============================================================================
//  lanecheck.mjs —— 验证「玩家横向移动时，路上的车跟着动」这个现象
//  做法：把跑速钉成 0（不前进），只做变道，看障碍/底板的世界坐标有没有变。
//  用法： node tools/lanecheck.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=high&theme=campus&v=${Date.now()}` }, 120000);
for (let i = 0; i < 240; i++) {
    if (await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break;
    await sleep(300);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; window.__noTurnFail=true; true');
await sleep(1200);

const out = await ev(`(async () => {
  const G = window.__game, C = G.CAMPUS;
  // 定住里程：速度改成 0，世界不前进，只留变道
  G.CONFIG.speed.start = 0; G.CONFIG.speed.max = 0; G.CONFIG.speed.factor = 1;
  G.S.speed = 0; G.Scene.segEnd = 999999;
  G.S.state = 'playing';
  C.s = 900;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 4; i++) await frame();

  // 放一辆校车在正前方 26m（最右车道）
  const bus = G.makeSchoolBus(12);
  G.addObstacle('schoolbus', 0, 20, 12, bus);
  const o = G.obstacles[G.obstacles.length - 1];
  for (let i = 0; i < 4; i++) await frame();

  const snap = () => ({
    lane: G.S.lane, sx: +G.S.x.toFixed(3), px: +G.player.root.position.x.toFixed(3),
    camx: +G.camera.position.x.toFixed(3), camz: +G.camera.position.z.toFixed(3),
    bus: [+o.mesh.position.x.toFixed(3), +o.mesh.position.y.toFixed(3), +o.mesh.position.z.toFixed(3)],
    plate: [+C.group.position.x.toFixed(3), +C.group.position.z.toFixed(3)],
    s: +C.s.toFixed(2), theta: +(C.theta * 180 / Math.PI).toFixed(2),
    D: +G.S.D.toFixed(2),
  });
  const shots = [];
  shots.push(snap());
  G.moveLane(-1); for (let i = 0; i < 30; i++) await frame(); shots.push(snap());
  G.moveLane(1); for (let i = 0; i < 30; i++) await frame(); shots.push(snap());
  G.moveLane(1); for (let i = 0; i < 30; i++) await frame(); shots.push(snap());
  return shots;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('caught:', caught.length ? caught : 'none');
process.exit(0);
