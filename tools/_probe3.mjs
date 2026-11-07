// ============================================================================
//  _probe3.mjs —— 逐项验证优化手段的收益（只读，不写文件）
//  用法: node tools/_probe3.mjs
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9333, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = process.argv.find(a => a.startsWith('--file='))?.slice(7) || '.perf-real.html';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 120000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 120000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE, platform: 'Android' });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=mid&theme=city&t=0.68&wx=rain&v=${stamp}` }, 120000);
for (let i = 0; i < 300; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
console.error('ready');
await ev(`(()=>{const g=window.__game;g.startGame();g.QUALITY.adaptive=false;g.S.paused=false;return 1})()`);
await sleep(1000);

const out = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera;
  const W = R.domElement.width, H = R.domElement.height;
  const gl = R.getContext();
  const buf = new Uint8Array(W*H*4);
  const cover = () => { gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let n=0; for (let i=0;i<buf.length;i+=4) if (buf[i]>4||buf[i+1]>4||buf[i+2]>4) n++;
    return +(n/(W*H)).toFixed(4); };
  // 统计「有多少三角面落在 fog.far 之外」：按对象包围球中心深度近似
  const frameInfo = async () => {
    await new Promise(r=>requestAnimationFrame(r));
    await new Promise(r=>requestAnimationFrame(r));
    const t0 = performance.now();
    for (let i=0;i<10;i++) R.render(sc, cam);
    const ms = +((performance.now()-t0)/10).toFixed(2);
    return { calls: R.info.render.calls, tris: R.info.render.triangles, points: R.info.render.points, cpuMs: ms };
  };
  const res = {};

  // 0) 基准
  res.base = await frameInfo();
  res.fogFar = +sc.fog.far.toFixed(1);
  res.camFar0 = cam.far;

  // 1) camera.far 收敛到 fog.far*1.05
  cam.far = sc.fog.far * 1.05; cam.updateProjectionMatrix();
  res.farTight = await frameInfo();
  // 2) 再狠一点：fog.far*0.85（雾外的东西本来就看不见）
  cam.far = sc.fog.far * 0.85; cam.updateProjectionMatrix();
  res.farTighter = await frameInfo();
  cam.far = 230; cam.updateProjectionMatrix();
  res.farRestored = await frameInfo();

  // 3) 关雾片（mist sprite）
  const mist = sc.children.find(o => o.isGroup && o.children.length && o.children[0].isSprite && o.children.length >= 5);
  let mistCover = null;
  if (mist) {
    const v = mist.visible; mist.visible = false;
    res.noMist = await frameInfo();
    mist.visible = v;
    // 单独测雾片覆盖
    const bg = sc.background; sc.background = new bg.constructor(0);
    const fg = sc.fog; sc.fog = null;
    const all = []; sc.traverse(o => { if (o.isMesh||o.isSprite||o.isPoints) all.push([o,o.visible]); });
    all.forEach(([o]) => o.visible = false);
    mist.visible = true;
    R.render(sc, cam); mistCover = cover();
    all.forEach(([o,v]) => o.visible = v);
    sc.background = bg; sc.fog = fg;
  }
  res.mistCoverageAlone = mistCover;

  // 4) 关雨
  const rain = sc.children.find(o => o.isPoints && o.geometry.attributes.position.count > 500);
  if (rain) { const v = rain.visible; rain.visible = false; res.noRain = await frameInfo(); rain.visible = v; }

  // 5) 全部 PBR(Standard/Physical) 材质临时换成 Basic —— 模拟「移动端不用 PBR」
  const swap = [];
  sc.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : [];
    for (const m of ms) {
      if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) {
        const b = new (o.material.constructor === Object ? Object : m.constructor)({});
        swap.push([o, m]);
      }
    }
  });
  // 只统计数量，不做真实替换（避免破坏场景）——改为统计 PBR 材质覆盖的屏幕比例
  res.pbrMatCount = swap.length;

  // 6) 半分辨率渲染（模拟 pr 从 1.25 降到 0.9）对 CPU 提交时间的影响
  const pr0 = R.getPixelRatio();
  R.setPixelRatio(0.9); res.pr09 = await frameInfo();
  R.setPixelRatio(1.25); res.pr125 = await frameInfo();
  R.setPixelRatio(pr0);

  // 7) 阴影 pass 的真实成本（含 reset 时机修正）
  const SM = R.shadowMap; const orig = SM.render.bind(SM);
  let sCalls = 0, sTris = 0, n = 0;
  SM.render = function(a,b,c) { const c0=R.info.render.calls, t0=R.info.render.triangles; orig(a,b,c); sCalls += R.info.render.calls-c0; sTris += R.info.render.triangles-t0; n++; };
  await new Promise(r=>setTimeout(r,2000));
  SM.render = orig;
  res.shadowPerPass = { calls: +(sCalls/n).toFixed(1), tris: Math.round(sTris/n), passes: n };

  // 8) 关阴影对主 pass 的 CPU 时间影响
  const sh = R.shadowMap.enabled; R.shadowMap.enabled = false;
  res.noShadowCpu = await frameInfo();
  R.shadowMap.enabled = sh;

  // 9) 程序数 & 材质数
  res.programs = R.info.programs.length;
  res.geometries = R.info.memory.geometries;
  res.textures = R.info.memory.textures;

  return JSON.stringify(res);
})()`));

console.log(JSON.stringify({ file: FILE, out }, null, 2));
ws.close();
