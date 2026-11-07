// 一次性诊断：校园底板各层逐个隔离，看谁在谁上面
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 40000) => { const id = ++seq; const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result)))); ws.send(JSON.stringify({ id, method: m, params: p })); return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async (e, tmo = 40000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false, screenWidth: 1000, screenHeight: 600 });
const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-real.html')).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=high&theme=campus&v=${stamp}` }, 90000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game === "object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => 0)) break; await sleep(300); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive = false; window.__noTurnFail = true; window.__wx.setTime(0.36); true');
await sleep(1200);

console.log(await ev(`(() => {
  const C = window.__game.CAMPUS;
  const out = [];
  C.group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry;
    out.push({ name: o.material && o.material.name, vis: o.visible,
      verts: g.attributes.position.count, y: [g.boundingBox ? 'cached' : 'no'],
      drawRange: g.drawRange.count, color: o.material.color ? o.material.color.getHexString() : '-',
      side: o.material.side, depthWrite: o.material.depthWrite, transparent: o.material.transparent,
      renderOrder: o.renderOrder });
  });
  return JSON.stringify(out, null, 1);
})()`));

// 只留 road，染成红色
await ev(`(() => {
  const C = window.__game.CAMPUS;
  C.group.traverse(o => { if (o.isMesh) o.visible = (o.material.name === 'green' || o.material.name === 'water' || o.material.name === 'paved'); });
  C.group.traverse(o => { if (o.isMesh && o.material.name === 'green') { o.material.color.set(0x00cc00); o.material.needsUpdate = true; }
                          if (o.isMesh && o.material.name === 'water') { o.material.color.set(0x0000ff); o.material.needsUpdate = true; }
                          if (o.isMesh && o.material.name === 'paved') { o.material.color.set(0xdddddd); o.material.needsUpdate = true; } });
  return true;
})()`);
await sleep(300);
{
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'screenshots/campus/_only_road.png'), Buffer.from(shot.data, 'base64'));
}
// 只留 walk
await ev(`(() => {
  const C = window.__game.CAMPUS;
  C.group.traverse(o => { if (o.isMesh) o.visible = true; });
  return true;
})()`);
await sleep(300);
{
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'screenshots/campus/_only_walk.png'), Buffer.from(shot.data, 'base64'));
}
console.log('done');
process.exit(0);
