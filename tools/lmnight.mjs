// 地标夜景探针：把指定的 GLB 地标沿街滚到镜头前 DIST 米，按时刻截图；顺便收 shader 报错。
//   node tools/lmnight.mjs --kind=pearl --dist=38 --out=screenshots/lm-pearl.png
//   node tools/lmnight.mjs --kind=pearl --air --out=screenshots/lm-pearl-air.png
//
// 注意：城市的「世界滚动」是逐帧累加 step，不是按 S.D 直接摆位——
// 直接改 S.D 不会让地标移动（踩过）。所以这里改成跑帧推进，量到位置就停。
import fs from 'node:fs';
const PORT = +(process.env.CDP_PORT || 9222), HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const KIND = val('--kind', 'pearl');
const T = val('--t', '0.72');
const DIST = +val('--dist', '38');
const OUT = val('--out', 'screenshots/lm-night.png');
const AIR = argv.includes('--air');
const FILE = val('--file', '.perf-real.html');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        caught.push('ERR ' + (m.params.args.map(a => a.description || a.value).join(' ') || '').slice(0, 300));
    }
});
const send = (m, p = {}, tmo = 240000) => new Promise((a, b) => {
    const id = ++seq; pend.set(id, x => x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); b(new Error('tmo ' + m)); } }, tmo);
});
const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/${FILE}?q=high&theme=city&t=${T}&v=${Date.now()}` }, 240000);
for (let i = 0; i < 300; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(400); }

console.log('registered', JSON.stringify(await ev(`window.__game.LMGLB.list().map(x => x.kind + ':' + x.h + 'm:' + x.mats.map(m => m.tag).join('|'))`)));

// 跑帧推进，把目标地标滚到 -DIST
const moved = await ev(`(() => {
  const G = window.__game, v = new G.camera.position.constructor();
  G.startGame(); G.QUALITY.adaptive=false;
  G.S.state='playing'; G.Scene.phase='run'; G.Scene.segEnd=1e9;
  if (window.__wx && window.__wx.setTime) window.__wx.setTime(${T});
  G.CONFIG.speed.start = 90; G.CONFIG.speed.max = 90;
  const zOf = () => {
    let best = null;
    G.worldGroup.traverse(o => {
      if (!(o.userData && o.userData.glbKind === '${KIND}')) return;
      const p = o.getWorldPosition(v);
      if (p.z < 40 && (best === null || Math.abs(p.z + ${DIST}) < Math.abs(best + ${DIST}))) best = p.z;
    });
    return best;
  };
  const z0 = zOf();
  let frames = 0;
  for (let i = 0; i < 900; i++) {
    G.S.transGrace = 99;
    G.step(1 / 60);
    frames++;
    const z = zOf();
    if (z !== null && Math.abs(z + ${DIST}) < 2.5) break;
  }
  const zf = zOf();
  return { kind: '${KIND}', z0: z0 === null ? null : +z0.toFixed(1), z: zf === null ? null : +zf.toFixed(1), frames, D: Math.round(G.S.D) };
})()`);
console.log('moved', JSON.stringify(moved));
await sleep(260);

console.log('near', JSON.stringify(await ev(`(() => {
  const G = window.__game, out = [], v = new G.camera.position.constructor();
  G.worldGroup.traverse(o => { if (!(o.userData && o.userData.glbKind)) return;
    const p = o.getWorldPosition(v); if (p.z > -220) out.push({ k: o.userData.glbKind, x: +p.x.toFixed(1), z: +p.z.toFixed(1) }); });
  return out;
})()`)));

const CAM = val('--cam', AIR ? '6,64,40' : '0,3.4,7').split(',').map(Number);
const LOOK = val('--look', AIR ? '0,36,-180' : '-3,26,-' + DIST).split(',').map(Number);
const FOV = +val('--fov', AIR ? 60 : 64);
await ev(`(() => { const G = window.__game, cam = G.camera;
  G.scene.fog.near = ${AIR ? 300 : 110}; G.scene.fog.far = ${AIR ? 1400 : 480};
  cam.fov = ${FOV}; cam.updateProjectionMatrix();
  cam.position.set(${CAM[0]}, ${CAM[1]}, ${CAM[2]}); cam.up.set(0,1,0);
  cam.lookAt(${LOOK[0]}, ${LOOK[1]}, ${LOOK[2]});
  window.__freezeCam = true; return 1; })()`);
await sleep(650);

const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(s.data, 'base64'));
console.log('shot', OUT);
console.log('caught', caught.length ? caught.slice(0, 6) : 'none');
process.exit(0);
