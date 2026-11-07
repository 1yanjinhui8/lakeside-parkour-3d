// 隔离诊断：只隐藏 green（草地），看湖面是否「变大」
// 用法：node tools/_isolate2.mjs
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = 'screenshots/campus';
const PORT = 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
};
const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const b64 = r.result && r.result.data;
    if (!b64) { console.log('shot failed:', JSON.stringify(r).slice(0, 200)); return; }
    const f = path.join(ROOT, OUT, name);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    console.log('shot ->', f);
};

await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:8766/.perf-real.html` });
await sleep(6000);

await ev(`(() => {
  const G = window.__game;
  G.startGame();
  G.QUALITY.adaptive = false;
  window.__noTurnFail = true;
  return true;
})()`);
await sleep(1500);
await ev(`(window.__wx && window.__wx.setTime) ? (window.__wx.setTime(0.36), true) : false`);
await sleep(600);

// 停在湖滨段
await ev(`(() => { const C = window.__game.CAMPUS; C.s = 1680; C.jIdx = 0; C.jLap = 0; return true; })()`);
await sleep(500);
await shot('_a_all.png');

// 关掉草地
await ev(`(() => {
  const C = window.__game.CAMPUS;
  C.group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'green') o.visible = false; });
  return true;
})()`);
await sleep(400);
await shot('_b_nograss.png');

// 只留水面
await ev(`(() => {
  const C = window.__game.CAMPUS;
  C.group.traverse(o => { if (o.isMesh && o.material) o.visible = (o.material.name === 'water'); });
  return true;
})()`);
await sleep(400);
await shot('_c_wateronly.png');

// 恢复 + 俯视
await ev(`(() => {
  const C = window.__game.CAMPUS;
  C.group.traverse(o => { if (o.isMesh) o.visible = true; });
  const G = window.__game, cam = G.camera;
  G.scene.fog.near = 20000; G.scene.fog.far = 40000;
  cam.fov = 45; cam.position.set(-260, 420, 120); cam.lookAt(-420, 0, 60);
  cam.updateProjectionMatrix();
  window.__freezeCam = true;
  return true;
})()`);
await sleep(500);
await shot('_d_overhead.png');

ws.close();
