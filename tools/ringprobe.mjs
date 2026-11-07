// ============================================================================
//  ringprobe.mjs —— 地标环构图调试：冻结相机，按给定机位连拍
//  用法：node tools/ringprobe.mjs --tag=a --cam=48,30,48,80 --az=0,60,120,180,240,300
//     --cam  = 轨道半径,俯角,取景点高度, fov
//     --az   = 方位角列表（0 = 相机在玩家正后方 +z）
//     --file = 默认 .perf-real.html
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const TAG = val('--tag', 'rp');
const CAM = val('--cam', '48,30,48,80').split(',').map(Number);
const AZ = val('--az', '0,60,120,180,240,300').split(',').map(Number);
const HIDECITY = argv.includes('--hidecity');
const OUT = path.join(ROOT, 'screenshots');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push(desc.slice(0, 400));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&t=0.68&wx=clear&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await ev(`window.__game.Scene.phase = 'run'; window.__game.Scene.fanfareDone = true; true`);  // 不触发真过场
await sleep(600);

// 推进到尾声：传送门 / 新葡京 / 地标环都在这个区间摆出
// 注意 segEnd 是随机的（3000±），必须按 segEnd 算，不能写死 2966
await ev(`(()=>{const g=window.__game;
  if (!g.Scene.next) g.Scene.next = 'campus';
  g.Scene.phase = 'run';
  g.Scene.fanfareDone = true;
  // 直接跳到「洞口还有 100m 就要摆出来」的那一刻，再走 66m 到过场触发点。
  // 全程只走 ~130 帧，比从头跑 3000m 快两个数量级，也不会被中途死亡/换场打断。
  g.S.D = Math.max(0, g.Scene.segEnd - 100.4);
  g.S.transGrace = 1e9;
  g.step(1/60);                                   // 这一帧把洞口 / 新葡京 / 地标环摆出来
  let n = 0;
  while (g.S.D < g.Scene.segEnd - 34 && n++ < 2000) { g.S.transGrace = 1e9; g.step(1/60); }
  g.S.paused = true;
  return Math.round(g.S.D); })()`);
await sleep(300);

console.log('状态:', await ev(`JSON.stringify({
  D: Math.round(window.__game.S.D), id: window.__game.Scene.id,
  portal: window.__game.PortalFX.group ? Math.round(window.__game.PortalFX.group.position.z) : null,
  lisboa: window.__game.LisboaFX.group ? Math.round(window.__game.LisboaFX.group.position.z) : null,
  ring: window.__game.RingFX.group ? Math.round(window.__game.RingFX.group.position.z) : null,
  ringMeshes: window.__game.RingFX.group ? (()=>{let n=0;window.__game.RingFX.group.traverse(o=>{if(o.isMesh)n++});return n})() : 0,
  ringTopY: window.__game.RingFX.group ? (()=>{const g=window.__game;g.RingFX.group.updateMatrixWorld(true);let mx=-1e9;g.RingFX.group.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox,m=o.matrixWorld.elements;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const wy=m[1]*x+m[5]*y+m[9]*z+m[13];if(wy>mx)mx=wy;}});return Math.round(mx)})() : null,
  player: window.__game.player.root.position.toArray().map(v=>+v.toFixed(2)),
  next: window.__game.Scene.next, phase: window.__game.Scene.phase, st: window.__game.S.state,
  pkind: window.__game.PortalFX.kind, segEnd: Math.round(window.__game.Scene.segEnd),
})`));

// 冻结相机：FINISH.active = true 时主循环不再调 updateCamera，finishCam 空闲也不写相机
await ev(`(()=>{const g=window.__game;
  window.__hideCity = ${HIDECITY};
  g.S.paused = true;                 // 冻住世界：不然世界还会往前滚，环就跑掉了
  g.FINISH.active = true;
  g.finishCam._phase = 'idle';
  if (g.scene.fog) { g.scene.fog.near = 90; g.scene.fog.far = 620; }
  g.camera.far = 620; g.camera.updateProjectionMatrix();
  if (window.__hideCity) { let n=0; g.scenery.forEach(o=>{ if(o.userData.tiling){ o.visible=false; n++; } }); console.log('hidden', n); }
  let h = null, s = null;
  g.scene.traverse(o => { if (o.isHemisphereLight) h = o; if (o.isDirectionalLight && !s) s = o; });
  if (h) h.intensity = Math.max(h.intensity, 1.25);
  if (s) s.intensity = Math.max(s.intensity, 0.55);
  return true; })()`);

fs.mkdirSync(OUT, { recursive: true });
await sleep(2600);      // 等 applyFinishFog 把补光/拉雾推到稳态，否则拍出来比实机暗
const [R, P, GZ, FOV] = CAM;
const EYE = val('--eye', '');
const AT = val('--at', '');
const files = [];
if (EYE) {
    const e = EYE.split(',').map(Number), a = AT.split(',').map(Number);
    await ev(`(()=>{const g=window.__game;
      g.camera.position.set(${e[0]},${e[1]},${e[2]});
      g.camera.lookAt(${a[0]},${a[1]},${a[2]});
      g.camera.fov=${FOV}; g.camera.updateProjectionMatrix(); return 1; })()`);
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fp = path.join(OUT, `${TAG}-eye.png`);
    fs.writeFileSync(fp, Buffer.from(shot.data, 'base64'));
    console.log('截图:', fp);
    ws.close();
    process.exit(0);
}
for (const az of AZ) {
    const ok = await ev(`(()=>{const g=window.__game;
      const R=${R}, P=${P}*Math.PI/180, GZ=${GZ}, FOV=${FOV}, AZ=${az}*Math.PI/180;
      const p = g.player.root.position;
      const fx = p.x, fy = p.y + GZ, fz = p.z;
      const cam = g.camera;
      cam.position.set(fx + Math.sin(AZ)*R, fy + Math.tan(P)*R, fz + Math.cos(AZ)*R);
      cam.lookAt(fx, fy, fz);
      cam.fov = FOV; cam.updateProjectionMatrix();
      return cam.position.toArray().map(v=>+v.toFixed(1)); })()`);
    await sleep(450);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fp = path.join(OUT, `${TAG}-az${String(az).padStart(3, '0')}.png`);
    fs.writeFileSync(fp, Buffer.from(shot.data, 'base64'));
    files.push(path.basename(fp));
    console.log('  az', az, '->', JSON.stringify(ok));
}
console.log('截图:', JSON.stringify(files));
console.log('异常:', JSON.stringify(caught.slice(0, 3)));
ws.close();
